//! Durable desktop settings, exposed through the same capability registry as
//! the rest of the application.
//!
//! The frontend keeps a synchronous in-memory mirror, but this file is the
//! source of truth. Each mutation writes a complete, schema-versioned document
//! to a sibling temporary file and renames it into place.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use srelens_capability::{Annotations, Capability, CapabilityError};

const SCHEMA_VERSION: u32 = 1;
const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
struct SettingsDocument {
    schema_version: u32,
    local_storage_migrated: bool,
    values: BTreeMap<String, Value>,
}

impl Default for SettingsDocument {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            local_storage_migrated: false,
            values: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct GetSettingsInput {
    /// Return only this key. Omit it to return the complete settings map.
    key: Option<String>,
}

impl Default for GetSettingsInput {
    fn default() -> Self {
        Self { key: None }
    }
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct GetSettingsOutput {
    schema_version: u32,
    local_storage_migrated: bool,
    values: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct SetSettingsInput {
    /// Keys to insert or replace in one atomic write.
    values: BTreeMap<String, Value>,
    /// Keys to remove in the same atomic write.
    remove: Vec<String>,
    /// Set by the desktop after its one-time localStorage import succeeds.
    local_storage_migrated: Option<bool>,
}

impl Default for SetSettingsInput {
    fn default() -> Self {
        Self {
            values: BTreeMap::new(),
            remove: Vec::new(),
            local_storage_migrated: None,
        }
    }
}

#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SetSettingsOutput {
    saved: bool,
}

struct FileSettingsStore {
    path: PathBuf,
}

impl FileSettingsStore {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn document(&self) -> Result<SettingsDocument, String> {
        // Re-read for every capability call. GUI and headless MCP processes
        // can coexist; keeping a process-local document cached would let a
        // later write overwrite settings changed by the other process.
        read_document(&self.path)
    }

    fn update(&self, input: SetSettingsInput) -> Result<(), String> {
        validate_keys(input.values.keys().map(String::as_str))?;
        validate_keys(input.remove.iter().map(String::as_str))?;

        let mut next = self.document()?;
        for (key, value) in input.values {
            next.values.insert(key, value);
        }
        for key in input.remove {
            next.values.remove(&key);
        }
        if let Some(migrated) = input.local_storage_migrated {
            next.local_storage_migrated = migrated;
        }
        write_document(&self.path, &next)?;
        Ok(())
    }
}

fn validate_keys<'a>(keys: impl Iterator<Item = &'a str>) -> Result<(), String> {
    for key in keys {
        if key.trim().is_empty() {
            return Err("setting key must not be empty".into());
        }
        if key.len() > 256 {
            return Err("setting key must be at most 256 bytes".into());
        }
        if key.chars().any(char::is_control) {
            return Err("setting key must not contain control characters".into());
        }
    }
    Ok(())
}

fn read_document(path: &Path) -> Result<SettingsDocument, String> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SettingsDocument::default())
        }
        Err(error) => return Err(format!("read {}: {error}", path.display())),
    };
    if raw.len() > MAX_DOCUMENT_BYTES {
        return Err(format!("{} exceeds the 1 MB settings limit", path.display()));
    }
    let document: SettingsDocument = serde_json::from_slice(&raw)
        .map_err(|error| format!("parse {}: {error}", path.display()))?;
    if document.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported settings schema {} in {} (expected {})",
            document.schema_version,
            path.display(),
            SCHEMA_VERSION
        ));
    }
    Ok(document)
}

fn write_document(path: &Path, document: &SettingsDocument) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;

    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("settings.json");
    let temp = parent.join(format!(".{file_name}.tmp-{}", std::process::id()));
    let raw = serde_json::to_vec_pretty(document).map_err(|error| error.to_string())?;
    if raw.len() > MAX_DOCUMENT_BYTES {
        return Err("settings document exceeds the 1 MB limit".into());
    }

    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temp)
        .map_err(|error| format!("create {}: {error}", temp.display()))?;
    if let Err(error) = file
        .write_all(&raw)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
    {
        let _ = fs::remove_file(&temp);
        return Err(format!("write {}: {error}", temp.display()));
    }
    drop(file);
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!("replace {}: {error}", path.display()));
    }
    Ok(())
}

/// The stable settings path shared by GUI and headless MCP launches. It is
/// derived from the Tauri bundle identifier, so binary renames do not move it.
pub fn default_settings_path() -> PathBuf {
    dirs::config_dir()
        .expect("could not resolve the platform config directory")
        .join("app.srelens.desktop")
        .join("settings.json")
}

/// Register `settings.get` and `settings.set` backed by `path`.
pub fn register(registry: &mut srelens_capability::Registry, path: PathBuf) {
    // The GUI bridge and its in-process MCP server build separate registries.
    // Reuse one store per path so their read/modify/write cycles cannot race
    // and overwrite each other inside the same process.
    static STORES: OnceLock<Mutex<BTreeMap<PathBuf, Weak<Mutex<FileSettingsStore>>>>> =
        OnceLock::new();
    let stores = STORES.get_or_init(|| Mutex::new(BTreeMap::new()));
    let mut stores = stores.lock().expect("settings store map lock poisoned");
    let store = stores
        .get(&path)
        .and_then(Weak::upgrade)
        .unwrap_or_else(|| {
            let store = Arc::new(Mutex::new(FileSettingsStore::new(path.clone())));
            stores.insert(path, Arc::downgrade(&store));
            store
        });
    drop(stores);

    let get_store = store.clone();
    registry.register(Capability::typed::<GetSettingsInput, GetSettingsOutput, _, _>(
        "settings.get",
        "read durable desktop settings; omit key to return the complete map",
        Annotations::READ_ONLY,
        move |input| {
            let store = get_store.clone();
            async move {
                let guard = store
                    .lock()
                    .map_err(|_| CapabilityError::Handler("settings lock poisoned".into()))?;
                let document = guard.document().map_err(CapabilityError::Handler)?;
                let values = match input.key {
                    Some(key) => {
                        validate_keys(std::iter::once(key.as_str()))
                            .map_err(CapabilityError::InvalidInput)?;
                        document
                            .values
                            .get(&key)
                            .cloned()
                            .map(|value| BTreeMap::from([(key, value)]))
                            .unwrap_or_default()
                    }
                    None => document.values.clone(),
                };
                Ok(GetSettingsOutput {
                    schema_version: document.schema_version,
                    local_storage_migrated: document.local_storage_migrated,
                    values,
                })
            }
        },
    ));

    registry.register(Capability::typed::<SetSettingsInput, SetSettingsOutput, _, _>(
        "settings.set",
        "atomically write or remove durable desktop settings",
        Annotations::MUTATING,
        move |input| {
            let store = store.clone();
            async move {
                let guard = store
                    .lock()
                    .map_err(|_| CapabilityError::Handler("settings lock poisoned".into()))?;
                guard.update(input).map_err(CapabilityError::Handler)?;
                Ok(SetSettingsOutput { saved: true })
            }
        },
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn document_roundtrips_and_reopens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = FileSettingsStore::new(path.clone());
        store
            .update(SetSettingsInput {
                values: BTreeMap::from([
                    ("theme".into(), json!({"mode": "dark"})),
                    ("scale".into(), json!(120)),
                ]),
                remove: vec![],
                local_storage_migrated: Some(true),
            })
            .unwrap();

        let reopened = read_document(&path).unwrap();
        assert_eq!(reopened.schema_version, SCHEMA_VERSION);
        assert!(reopened.local_storage_migrated);
        assert_eq!(reopened.values["scale"], json!(120));
        assert_eq!(reopened.values["theme"], json!({"mode": "dark"}));
        assert!(!dir.path().join(format!(".settings.json.tmp-{}", std::process::id())).exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn failed_update_does_not_change_the_loaded_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = FileSettingsStore::new(path);
        store
            .update(SetSettingsInput {
                values: BTreeMap::from([("ok".into(), json!(1))]),
                ..Default::default()
            })
            .unwrap();
        let error = store
            .update(SetSettingsInput {
                values: BTreeMap::from([("\n".into(), json!(2))]),
                ..Default::default()
            })
            .unwrap_err();
        assert!(error.contains("control"));
        assert_eq!(
            store.document().unwrap().values,
            BTreeMap::from([("ok".into(), json!(1))])
        );
    }

    #[tokio::test]
    async fn capabilities_read_write_filter_and_remove() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = srelens_capability::Registry::new();
        register(&mut registry, dir.path().join("settings.json"));

        registry
            .invoke(
                "settings.set",
                json!({"values": {"a": 1, "b": {"nested": true}}, "localStorageMigrated": true}),
            )
            .await
            .unwrap();
        let one = registry.invoke("settings.get", json!({"key": "b"})).await.unwrap();
        assert_eq!(one["values"], json!({"b": {"nested": true}}));
        assert_eq!(one["localStorageMigrated"], json!(true));

        registry
            .invoke("settings.set", json!({"remove": ["a"]}))
            .await
            .unwrap();
        let all = registry.invoke("settings.get", json!({})).await.unwrap();
        assert_eq!(all["values"], json!({"b": {"nested": true}}));

        assert_eq!(registry.get("settings.get").unwrap().annotations, Annotations::READ_ONLY);
        assert_eq!(registry.get("settings.set").unwrap().annotations, Annotations::MUTATING);
    }

    #[test]
    fn corrupt_or_future_documents_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, b"{not json").unwrap();
        assert!(read_document(&path).unwrap_err().contains("parse"));
        fs::write(
            &path,
            br#"{"schema_version":99,"local_storage_migrated":false,"values":{}}"#,
        )
        .unwrap();
        assert!(read_document(&path).unwrap_err().contains("unsupported settings schema"));
    }

    #[test]
    fn oversized_documents_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, vec![b' '; MAX_DOCUMENT_BYTES + 1]).unwrap();
        assert!(read_document(&path).unwrap_err().contains("1 MB"));

        let document = SettingsDocument {
            values: BTreeMap::from([("large".into(), json!("x".repeat(MAX_DOCUMENT_BYTES)))]),
            ..Default::default()
        };
        assert!(write_document(&path, &document).unwrap_err().contains("1 MB"));
    }

    #[test]
    fn default_path_is_bound_to_the_application_identifier() {
        let path = default_settings_path();
        assert!(path.ends_with(Path::new("app.srelens.desktop").join("settings.json")));
    }
}
