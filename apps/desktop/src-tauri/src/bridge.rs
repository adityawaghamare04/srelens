//! Bridges the capability registry to the Tauri WebView as a command.
//!
//! This is the Tauri half of "one definition, two surfaces": the same
//! `Registry` that backs the MCP server is invoked here from the frontend.

use srelens_capability::Registry;
use serde_json::Value;
use tauri::State;

/// Tauri-managed state holding the capability registry.
pub struct AppRegistry(pub Registry);

/// Invoke a backend capability by id. The WebView calls this via
/// `invoke('invoke_capability', { id, input })`.
#[tauri::command]
pub async fn invoke_capability(
    id: String,
    input: Value,
    registry: State<'_, AppRegistry>,
) -> Result<Value, String> {
    registry.0.invoke(&id, input).await.map_err(|e| {
        // Surface capability failures (connection timeouts, denied RBAC, bad
        // input) to the application log for post-hoc diagnosis.
        let message = e.to_string();
        log::warn!("capability '{id}' failed: {message}");
        message
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use srelens_capability::Capability;
    use tauri::Manager;

    /// Both bridge paths through a MockRuntime app: a registered capability's
    /// value passes through untouched, and a failure (unknown id here) comes
    /// back as the flat string the WebView renders.
    #[tokio::test]
    async fn passes_values_through_and_flattens_errors() {
        let mut registry = Registry::new();
        registry.register(Capability::read_only("test.echo", "echo", |input| async move {
            Ok(json!({ "echoed": input }))
        }));
        let app = tauri::test::mock_app();
        app.manage(AppRegistry(registry));

        let value = invoke_capability("test.echo".into(), json!({"k": 1}), app.state())
            .await
            .unwrap();
        assert_eq!(value, json!({ "echoed": { "k": 1 } }));

        let e = invoke_capability("test.missing".into(), json!({}), app.state())
            .await
            .unwrap_err();
        assert!(e.contains("test.missing"), "unexpected error: {e}");
    }
}
