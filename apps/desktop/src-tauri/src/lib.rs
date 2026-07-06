mod bridge;
mod capabilities;
mod exec;
mod files;
mod forward;
mod logs;
mod watch;

use bridge::{invoke_capability, AppRegistry};
use files::{pick_kubeconfig_files, save_pasted_kubeconfig, save_text_file};
use exec::{exec_close, exec_input, start_pod_exec, ExecManager};
use forward::{start_port_forward, stop_port_forward, ForwardManager};
use srelens_kube::client_cache::ClientCache;
use logs::{start_log_stream, stop_log_stream, LogStreamManager};
use watch::{start_resource_watch, stop_watch, WatchManager};

pub use capabilities::build_registry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            save_pasted_kubeconfig
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
