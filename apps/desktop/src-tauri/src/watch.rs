//! Tauri adapter for live watches: the streaming core lives in
//! srelens_streams::watch; this module only maps the Tauri command surface.
//!
//! Commands are generic over the runtime (#28): the unit suite below drives
//! them through `tauri::test::MockRuntime`, so this surface counts toward
//! coverage instead of hiding behind the ignore-regex.

use std::sync::Arc;

use srelens_streams::watch::WatchManager;
use tauri::{AppHandle, Runtime, State};

use crate::sink::TauriSink;

/// Start watching a watchable resource kind in a namespace, emitting each full
/// sorted snapshot on the caller-provided `channel`. The WebView subscribes to
/// `channel` first, then invokes this, so the initial snapshot can't race
/// ahead of the listener.
#[tauri::command]
pub async fn start_resource_watch<R: Runtime>(
    context: String,
    namespace: String,
    kind: String,
    channel: String,
    kubeconfig_paths: Vec<String>,
    app: AppHandle<R>,
    manager: State<'_, WatchManager>,
) -> Result<String, String> {
    manager
        .start(
            Arc::new(TauriSink(app)),
            context,
            namespace,
            kind,
            channel,
            kubeconfig_paths
                .into_iter()
                .map(std::path::PathBuf::from)
                .collect(),
        )
        .await
}

/// Stop a running watch by its channel.
#[tauri::command]
pub async fn stop_watch(channel: String, manager: State<'_, WatchManager>) -> Result<(), String> {
    manager.stop(&channel);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_kube::client_cache::ClientCache;
    use tauri::Manager;

    /// start registers the extra kubeconfig path, spawns the watch task, and
    /// echoes the channel back (the unresolvable context fails INSIDE the
    /// task, surfacing as an error payload on the channel — never here);
    /// stop aborts it, and an unknown channel no-ops.
    #[tokio::test(flavor = "multi_thread")]
    async fn commands_run_against_a_mock_runtime() {
        let app = tauri::test::mock_app();
        app.manage(WatchManager::new(ClientCache::new_many(vec![])));

        let channel = start_resource_watch(
            "no-such-context".into(),
            "ns".into(),
            "pods".into(),
            "watch:test".into(),
            vec!["/nonexistent/kubeconfig".into()],
            app.handle().clone(),
            app.state(),
        )
        .await
        .unwrap();
        assert_eq!(channel, "watch:test");

        stop_watch(channel, app.state()).await.unwrap();
        stop_watch("watch:unknown".into(), app.state()).await.unwrap();
    }
}
