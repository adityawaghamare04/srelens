//! Tauri adapter for port-forwards: the core lives in
//! srelens_streams::forward; this module only maps the Tauri command surface.
//!
//! Commands are generic over the runtime (#28): the unit suite below drives
//! them through `tauri::test::MockRuntime`, so this surface counts toward
//! coverage instead of hiding behind the ignore-regex.

use std::sync::Arc;

use srelens_streams::forward::{ForwardInfo, ForwardManager};
use tauri::{AppHandle, Runtime, State};

use crate::sink::TauriSink;

/// Start forwarding a local port to a Pod or Service. `kind` is "Pod" or
/// "Service"; a Service is resolved to a backing pod and target port first.
/// Returns the id + bound local port; a `forward:closed:<id>` event fires
/// (with an optional error string) if the forward loop ends on its own.
#[tauri::command]
pub async fn start_port_forward<R: Runtime>(
    context: String,
    namespace: String,
    kind: String,
    name: String,
    remote_port: u16,
    local_port: Option<u16>,
    app: AppHandle<R>,
    manager: State<'_, ForwardManager>,
) -> Result<ForwardInfo, String> {
    manager
        .start(
            Arc::new(TauriSink(app)),
            context,
            namespace,
            kind,
            name,
            remote_port,
            local_port,
        )
        .await
}

/// Stop a port-forward and abort its task.
#[tauri::command]
pub async fn stop_port_forward(id: u64, manager: State<'_, ForwardManager>) -> Result<(), String> {
    manager.stop(id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use srelens_kube::client_cache::ClientCache;
    use tauri::Manager;

    /// start binds the local listener synchronously — an ephemeral port comes
    /// back even though the forward loop itself will die on the unresolvable
    /// context — and stop tears the forward down (twice: unknown id no-ops).
    #[tokio::test(flavor = "multi_thread")]
    async fn commands_run_against_a_mock_runtime() {
        let app = tauri::test::mock_app();
        app.manage(ForwardManager::new(ClientCache::new_many(vec![])));

        let info = start_port_forward(
            "no-such-context".into(),
            "ns".into(),
            "Pod".into(),
            "pod-0".into(),
            8080,
            None,
            app.handle().clone(),
            app.state(),
        )
        .await
        .unwrap();
        assert_ne!(info.local_port, 0, "an ephemeral port must have been bound");

        stop_port_forward(info.id, app.state()).await.unwrap();
        stop_port_forward(info.id + 1, app.state()).await.unwrap();
    }
}
