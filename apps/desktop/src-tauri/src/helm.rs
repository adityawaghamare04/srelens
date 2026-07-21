//! Streaming bridge for helm write operations: runs the user's `helm` against a
//! context-scoped kubeconfig and streams stdout+stderr to the WebView over
//! Tauri events. Desktop-only; the collectable form lives in the capability
//! registry (srelens_kube::helm_cli).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::task::JoinHandle;

/// Read `reader` line-by-line, calling `emit` for each line (newline stripped).
pub async fn stream_lines<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
    mut emit: impl FnMut(String),
) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        emit(line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stream_lines_emits_each_line() {
        let data = &b"first\nsecond\nthird\n"[..];
        let mut got = Vec::new();
        stream_lines(data, |l| got.push(l)).await;
        assert_eq!(got, vec!["first", "second", "third"]);
    }
}

struct Session {
    handle: JoinHandle<()>,
}

/// Tauri-managed state owning running helm operations (keyed by numeric id).
pub struct HelmManager {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<u64, Session>>,
}

impl HelmManager {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// Run `helm <args>` scoped to `context`, streaming stdout+stderr on
/// `helm:out:<channel>`; `helm:exit:<channel>` fires with None on success or an
/// error string on failure. Returns the session id.
#[tauri::command]
pub async fn start_helm_op(
    context: String,
    extra_kubeconfigs: Vec<String>,
    args: Vec<String>,
    values: String,
    channel: String,
    app: AppHandle,
    manager: State<'_, HelmManager>,
) -> Result<u64, String> {
    let id = manager.next_id.fetch_add(1, Ordering::SeqCst);
    let bin = srelens_kube::helm_cli::helm_binary()?;

    let mut paths = crate::capabilities::default_kubeconfig_paths();
    paths.extend(extra_kubeconfigs.iter().map(std::path::PathBuf::from));
    let ctx = context.clone();
    let kubeconfig_path = tokio::task::spawn_blocking(move || {
        srelens_kube::connect::write_single_context_kubeconfig(&paths, &ctx)
    })
    .await
    .map_err(|e| e.to_string())??;
    // Guard wraps the kubeconfig so it's removed on every exit path (success,
    // error, or an aborted/cancelled session) — see `helm_op_close` below.
    let kubeconfig = srelens_kube::helm_cli::TempFile(kubeconfig_path);

    let values_file =
        srelens_kube::helm_cli::write_values_file(&values)?.map(srelens_kube::helm_cli::TempFile);
    let mut full_args = args;
    if let Some(ref vf) = values_file {
        full_args.push("--values".to_string());
        full_args.push(vf.path().display().to_string());
    }

    let out_channel = format!("helm:out:{channel}");
    let exit_channel = format!("helm:exit:{channel}");
    let app_out = app.clone();
    let app_err = app.clone();

    let handle = tokio::spawn(async move {
        // `kubeconfig` and `values_file` are moved into this task so they live
        // for the whole run and are removed via `Drop` when the task finishes
        // (any exit path) or is aborted (`helm_op_close`) — no manual cleanup.
        //
        // `values_file` MUST be bound here: an `async move` block only captures
        // the variables it MENTIONS, and the values path is otherwise only read
        // above (when building `full_args`). Without this binding the guard stays
        // a local of `start_helm_op` and drops the moment it returns — deleting
        // the values file while helm is still starting, so every install/upgrade
        // with values fails "no such file or directory". `kubeconfig` is captured
        // implicitly by the `.env(...)` call below.
        let _values_file = values_file;
        let spawn = tokio::process::Command::new(&bin)
            .args(&full_args)
            .env("KUBECONFIG", kubeconfig.path())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn();

        let result = match spawn {
            Ok(mut child) => {
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();
                let out_ch = out_channel.clone();
                let err_ch = out_channel.clone();
                let a1 = app_out.clone();
                let a2 = app_err.clone();
                let t_out = tokio::spawn(async move {
                    if let Some(s) = stdout {
                        stream_lines(s, |l| {
                            let _ = a1.emit(&out_ch, l);
                        })
                        .await;
                    }
                });
                let t_err = tokio::spawn(async move {
                    if let Some(s) = stderr {
                        stream_lines(s, |l| {
                            let _ = a2.emit(&err_ch, l);
                        })
                        .await;
                    }
                });
                let _ = t_out.await;
                let _ = t_err.await;
                match child.wait().await {
                    Ok(status) if status.success() => None,
                    Ok(status) => Some(format!(
                        "helm exited with code {}",
                        status.code().unwrap_or(-1)
                    )),
                    Err(e) => Some(e.to_string()),
                }
            }
            Err(e) => Some(e.to_string()),
        };
        let _ = app_out.emit(&exit_channel, result);
        // `kubeconfig` and (if present) `values_file` are dropped here, removing
        // their temp files.
    });

    manager
        .sessions
        .lock()
        .unwrap()
        .insert(id, Session { handle });
    Ok(id)
}

/// Abort a running helm operation (best-effort) and drop its session. The
/// aborted task's `TempFile` guards (kubeconfig, values file) are dropped as
/// part of cancelling the in-flight future, which removes their temp files.
#[tauri::command]
pub async fn helm_op_close(session: u64, manager: State<'_, HelmManager>) -> Result<(), String> {
    if let Some(s) = manager.sessions.lock().unwrap().remove(&session) {
        s.handle.abort();
    }
    Ok(())
}
