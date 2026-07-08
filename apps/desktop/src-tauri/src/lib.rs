mod bridge;
mod capabilities;
mod exec;
mod files;
mod forward;
mod logs;
mod settings;
mod updater;
mod watch;

use bridge::{invoke_capability, AppRegistry};
use files::{pick_kubeconfig_files, save_pasted_kubeconfig, save_text_file};
use exec::{exec_close, exec_input, start_pod_exec, ExecManager};
use forward::{start_port_forward, stop_port_forward, ForwardManager};
use srelens_kube::client_cache::ClientCache;
use logs::{start_log_stream, stop_log_stream, LogStreamManager};
use settings::{get_request_timeout, set_request_timeout};
use updater::{update_check, update_install};
use watch::{start_resource_watch, stop_watch, WatchManager};

pub use capabilities::build_registry;

/// Size the main window to a comfortable default, clamped to the screen it
/// opens on: on a large display it stays at the preferred ~16" size (centered),
/// on a smaller display it shrinks to fit the available work area. A margin
/// keeps it clear of the menu bar / taskbar / dock.
#[cfg(desktop)]
fn size_main_window(app: &tauri::App) {
    use tauri::{LogicalSize, Manager};

    // Preferred size — the "16-inch" window shown on big screens.
    const PREF_W: f64 = 1440.0;
    const PREF_H: f64 = 900.0;
    // Leave room for OS chrome so the window never sits edge-to-edge.
    const MARGIN: f64 = 80.0;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let avail_w = monitor.size().width as f64 / scale - MARGIN;
    let avail_h = monitor.size().height as f64 / scale - MARGIN;

    let width = PREF_W.min(avail_w).max(640.0);
    let height = PREF_H.min(avail_h).max(480.0);
    let _ = window.set_size(LogicalSize::new(width, height));
    let _ = window.center();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The SRELENS_TIMEOUT_SECS override is applied in `main()` before dispatch,
    // so it's live here; the Settings UI can adjust it further at runtime.

    // One shared client cache: request/response capabilities AND live watches
    // reuse the same authenticated kube-rs clients.
    let cache = ClientCache::new_many(capabilities::default_kubeconfig_paths());
    let registry = capabilities::build_registry_with(cache.clone());

    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(desktop)]
            size_main_window(app);
            Ok(())
        })
        .manage(AppRegistry(registry))
        .manage(WatchManager::new(cache.clone()))
        .manage(ExecManager::new(cache.clone()))
        .manage(ForwardManager::new(cache.clone()))
        .manage(LogStreamManager::new(cache))
        .invoke_handler(tauri::generate_handler![
            invoke_capability,
            start_resource_watch,
            stop_watch,
            start_pod_exec,
            exec_input,
            exec_close,
            start_port_forward,
            stop_port_forward,
            start_log_stream,
            stop_log_stream,
            save_text_file,
            pick_kubeconfig_files,
            save_pasted_kubeconfig,
            update_check,
            update_install,
            set_request_timeout,
            get_request_timeout
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
