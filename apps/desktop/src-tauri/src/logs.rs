//! Tauri adapter for live log tails: the streaming core lives in
//! srelens_streams::logs; this module only maps the Tauri command surface.
//!
//! Commands are generic over the runtime (#28): the unit suite below drives
//! them through `tauri::test::MockRuntime`, so this surface counts toward
//! coverage instead of hiding behind the ignore-regex.

use std::sync::Arc;

use srelens_streams::logs::{LogStreamManager, LogTarget};
use tauri::{AppHandle, Runtime, State};

use crate::sink::TauriSink;

/// Start following the given targets, emitting each line as a `LogLine` on the
/// caller-provided `channel`. The WebView subscribes to `channel` first, then
/// invokes this, so the initial tail lines can't race ahead of the listener.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_log_stream<R: Runtime>(
    context: String,
    namespace: String,
    targets: Vec<LogTarget>,
    channel: String,
    timestamps: Option<bool>,
    since_seconds: Option<i64>,
    tail_lines: Option<i64>,
    app: AppHandle<R>,
    manager: State<'_, LogStreamManager>,
) -> Result<(), String> {
    manager
        .start(
            Arc::new(TauriSink(app)),
            context,
            namespace,
            targets,
            channel,
            timestamps,
            since_seconds,
            tail_lines,
        )
        .await
}

/// Stop a log-tail stream and abort all of its follow tasks.
#[tauri::command]
pub async fn stop_log_stream(
    channel: String,
    manager: State<'_, LogStreamManager>,
) -> Result<(), String> {
    manager.stop(&channel);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_kube::client_cache::ClientCache;
    use tauri::Manager;

    /// The empty-target refusal comes back synchronously; a real target is
    /// accepted (its follow task dies later on the unresolvable context) and
    /// stop tears the stream down — plus the unknown-channel no-op.
    #[tokio::test(flavor = "multi_thread")]
    async fn commands_run_against_a_mock_runtime() {
        let app = tauri::test::mock_app();
        app.manage(LogStreamManager::new(ClientCache::new_many(vec![])));

        let e = start_log_stream(
            "no-such-context".into(),
            "ns".into(),
            vec![],
            "logs:test".into(),
            None,
            None,
            None,
            app.handle().clone(),
            app.state(),
        )
        .await
        .unwrap_err();
        assert!(e.contains("without a pod target"), "unexpected error: {e}");

        start_log_stream(
            "no-such-context".into(),
            "ns".into(),
            vec![LogTarget {
                pod: "pod-0".into(),
                container: None,
                label: String::new(),
            }],
            "logs:test".into(),
            Some(true),
            Some(60),
            Some(100),
            app.handle().clone(),
            app.state(),
        )
        .await
        .unwrap();

        stop_log_stream("logs:test".into(), app.state()).await.unwrap();
        stop_log_stream("logs:unknown".into(), app.state()).await.unwrap();
    }
}
