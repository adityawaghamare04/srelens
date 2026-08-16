//! Save-to-disk bridge: a native "save file" dialog plus a plain write. The
//! WebView's `<a download>` doesn't trigger a save in a Tauri webview, so log
//! (and other text) downloads go through here.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

/// Prompt for a save location (pre-filled with `filename`) and write `content`
/// there. Returns the chosen path, or `None` if the user cancelled.
#[tauri::command]
pub async fn save_text_file<R: Runtime>(
    app: AppHandle<R>,
    filename: String,
    content: String,
) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_file_name(&filename).blocking_save_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file.as_path().ok_or("invalid save path")?.to_path_buf();
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Select one or more existing kubeconfig files and return filesystem paths.
#[tauri::command]
pub async fn pick_kubeconfig_files<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    let picked = app.dialog().file().blocking_pick_files().unwrap_or_default();
    picked
        .into_iter()
        .map(|file| {
            file.as_path()
                .map(|path| path.to_string_lossy().into_owned())
                .ok_or_else(|| "invalid kubeconfig path".to_string())
        })
        .collect()
}

/// Validate pasted kubeconfig YAML and persist it under the app config folder.
#[tauri::command]
pub async fn save_pasted_kubeconfig<R: Runtime>(
    app: AppHandle<R>,
    content: String,
    name: Option<String>,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("kubeconfigs");
    save_pasted_kubeconfig_to(&directory, &content, name)
}

/// Everything but the config-dir lookup (#28 seam): size gate, YAML
/// validation, name sanitizing, and the timestamped write — unit-tested
/// against a temp directory.
fn save_pasted_kubeconfig_to(
    directory: &Path,
    content: &str,
    name: Option<String>,
) -> Result<String, String> {
    if content.len() > 1024 * 1024 {
        return Err("kubeconfig must be smaller than 1 MB".to_string());
    }
    srelens_kube::connect::validate_kubeconfig_yaml(content)?;

    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let stem = name
        .unwrap_or_else(|| "pasted".to_string())
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() || character == '-' { character } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(48)
        .collect::<String>();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let file_name = format!("{}-{timestamp}.yaml", if stem.is_empty() { "pasted" } else { &stem });
    let path = directory.join(file_name);
    fs::write(&path, content).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        std::env::temp_dir().join(format!(
            "srelens-files-{label}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ))
    }

    const VALID_KUBECONFIG: &str = "\
apiVersion: v1
kind: Config
clusters:
- name: c
  cluster: { server: 'https://127.0.0.1:1' }
contexts:
- name: ctx
  context: { cluster: c, user: u }
users:
- name: u
  user: {}
current-context: ctx
";

    #[test]
    fn writes_a_sanitized_timestamped_yaml_and_creates_the_directory() {
        let dir = temp_dir("save");
        let path = save_pasted_kubeconfig_to(
            &dir,
            VALID_KUBECONFIG,
            Some("My Cluster (prod)!".into()),
        )
        .unwrap();
        let file = std::path::Path::new(&path).file_name().unwrap().to_string_lossy().into_owned();
        // Every non [-a-zA-Z0-9] character became '-', edges trimmed.
        assert!(file.starts_with("My-Cluster--prod"), "unexpected name: {file}");
        assert!(file.ends_with(".yaml"), "unexpected name: {file}");
        assert_eq!(fs::read_to_string(&path).unwrap(), VALID_KUBECONFIG);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_nameless_or_fully_scrubbed_name_falls_back_to_pasted() {
        let dir = temp_dir("fallback");
        let unnamed = save_pasted_kubeconfig_to(&dir, VALID_KUBECONFIG, None).unwrap();
        let scrubbed =
            save_pasted_kubeconfig_to(&dir, VALID_KUBECONFIG, Some("!!!".into())).unwrap();
        for path in [unnamed, scrubbed] {
            let file =
                std::path::Path::new(&path).file_name().unwrap().to_string_lossy().into_owned();
            assert!(file.starts_with("pasted-"), "unexpected name: {file}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_and_invalid_content_are_refused_without_writing() {
        let dir = temp_dir("refused");
        let big = "x".repeat(1024 * 1024 + 1);
        let e = save_pasted_kubeconfig_to(&dir, &big, None).unwrap_err();
        assert!(e.contains("smaller than 1 MB"), "unexpected error: {e}");
        let e = save_pasted_kubeconfig_to(&dir, "not: [valid kubeconfig", None).unwrap_err();
        assert!(!e.is_empty());
        // Both refusals fired before the directory was ever created.
        assert!(!dir.exists());
    }
}
