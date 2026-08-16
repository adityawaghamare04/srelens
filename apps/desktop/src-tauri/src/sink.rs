//! Tauri implementation of the shared EventSink: events go to the WebView
//! over the exact same channels the frontend already subscribes to.
//!
//! Generic over the runtime so the unit suites can construct it against
//! `tauri::test::MockRuntime`; the app itself always instantiates it with
//! the default (Wry) runtime.

use srelens_streams::EventSink;
use tauri::{AppHandle, Emitter, Runtime};

pub struct TauriSink<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> EventSink for TauriSink<R> {
    fn emit(&self, channel: &str, payload: serde_json::Value) {
        let _ = self.0.emit(channel, payload);
    }
}
