//! Disk-backed cluster-overview snapshots, so a cold start can paint the
//! overview instantly from the last run instead of an empty loading state
//! (issue #148).
//!
//! Everything lives in one small `<config>/overview.json` file: a map of
//! context name → last snapshot, capped to the most recently refreshed
//! contexts. The `stats` payload is opaque JSON — the frontend owns its
//! shape (same contract as assistant session `messages`).
//!
//! This is a cache, not user data: a corrupt or unreadable file is treated
//! as empty rather than surfaced as an error, so a bad write can never
//! wedge the overview.
//!
//! The `#[tauri::command]` wrappers at the bottom only resolve the app
//! config dir and delegate; the pure `fn`s above them take a `path: &Path`
//! so tests can drive them against a throwaway temp file.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// One persisted overview: opaque frontend stats plus when they were fetched.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSnapshot {
    pub stats: serde_json::Value,
    pub updated_at: i64,
}

/// Keep the file small: only the most recently refreshed contexts survive.
const MAX_CONTEXTS: usize = 10;

/// Read the whole snapshot map, treating a missing or corrupt file as empty.
fn read_all(path: &Path) -> BTreeMap<String, PersistedSnapshot> {
    let Ok(raw) = fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Write the whole snapshot map atomically (`.tmp` + rename) so a crash
/// mid-write never leaves a half-written file behind. Owner-only (`0600` on
/// Unix; `rename` preserves the mode): the map names contexts and carries
/// warning-event messages, which mustn't be world-readable on a shared host.
fn write_all(path: &Path, all: &BTreeMap<String, PersistedSnapshot>) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string(all).map_err(|e| e.to_string())?;
    crate::assistant_history::write_private(&tmp, &raw)
        .map_err(|e| format!("could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("could not finalize {}: {e}", path.display()))
}

/// Last persisted snapshot for `context`, if any.
fn load(path: &Path, context: &str) -> Option<PersistedSnapshot> {
    read_all(path).remove(context)
}

/// Persist a snapshot for `context`, evicting the least recently updated
/// contexts beyond the cap.
fn save(path: &Path, context: &str, snapshot: PersistedSnapshot) -> Result<(), String> {
    let mut all = read_all(path);
    all.insert(context.to_owned(), snapshot);
    if all.len() > MAX_CONTEXTS {
        let mut by_age: Vec<_> = all.iter().map(|(c, s)| (s.updated_at, c.clone())).collect();
        by_age.sort();
        for (_, context) in &by_age[..all.len() - MAX_CONTEXTS] {
            all.remove(context);
        }
    }
    write_all(path, &all)
}

/// Drop one context's snapshot, or every snapshot when `context` is `None`.
/// Clearing what isn't there is not an error — clearing is idempotent.
fn clear(path: &Path, context: Option<&str>) -> Result<(), String> {
    match context {
        Some(context) => {
            let mut all = read_all(path);
            if all.remove(context).is_some() {
                write_all(path, &all)?;
            }
            Ok(())
        }
        None => match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("could not delete {}: {e}", path.display())),
        },
    }
}

/// Resolve `<app config dir>/overview.json` — the one bit of app-specific
/// wiring the pure helpers above don't do.
fn resolve_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(base.join("overview.json"))
}

/// Load the last persisted overview snapshot for a context, if any.
#[tauri::command]
pub fn overview_snapshot_load(
    app: AppHandle,
    context: String,
) -> Result<Option<PersistedSnapshot>, String> {
    Ok(load(&resolve_store_path(&app)?, &context))
}

/// Persist a context's overview snapshot for the next cold start.
#[tauri::command]
pub fn overview_snapshot_save(
    app: AppHandle,
    context: String,
    snapshot: PersistedSnapshot,
) -> Result<(), String> {
    save(&resolve_store_path(&app)?, &context, snapshot)
}

/// Drop one context's persisted snapshot, or all of them.
#[tauri::command]
pub fn overview_snapshot_clear(app: AppHandle, context: Option<String>) -> Result<(), String> {
    clear(&resolve_store_path(&app)?, context.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A fresh, empty directory under the OS temp dir, unique per test so
    /// parallel test runs never collide. Removed on drop so a test's fixture
    /// files don't linger.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "srelens-overview-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id(),
            ));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }

        fn file(&self) -> PathBuf {
            self.0.join("overview.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn snapshot(updated_at: i64, nodes: i64) -> PersistedSnapshot {
        PersistedSnapshot {
            stats: json!({ "nodes": { "total": nodes, "ready": nodes } }),
            updated_at,
        }
    }

    #[test]
    fn round_trips_a_snapshot_per_context() {
        let tmp = TempDir::new("roundtrip");
        save(&tmp.file(), "kind-a", snapshot(1000, 3)).unwrap();
        save(&tmp.file(), "kind-b", snapshot(2000, 5)).unwrap();

        assert_eq!(load(&tmp.file(), "kind-a"), Some(snapshot(1000, 3)));
        assert_eq!(load(&tmp.file(), "kind-b"), Some(snapshot(2000, 5)));
    }

    #[test]
    fn missing_file_loads_nothing() {
        let tmp = TempDir::new("missing");
        assert_eq!(load(&tmp.file(), "kind-a"), None);
    }

    #[test]
    fn corrupt_file_loads_nothing_and_saves_fresh() {
        let tmp = TempDir::new("corrupt");
        fs::write(tmp.file(), "{not json").unwrap();

        assert_eq!(load(&tmp.file(), "kind-a"), None);

        // A save starts the cache over rather than failing on the bad file.
        save(&tmp.file(), "kind-a", snapshot(1000, 3)).unwrap();
        assert_eq!(load(&tmp.file(), "kind-a"), Some(snapshot(1000, 3)));
    }

    #[test]
    fn keeps_only_the_most_recently_updated_contexts() {
        let tmp = TempDir::new("cap");
        for i in 0..12 {
            save(&tmp.file(), &format!("kind-{i}"), snapshot(i, 1)).unwrap();
        }

        // The two oldest fall off; the ten newest survive.
        assert_eq!(load(&tmp.file(), "kind-0"), None);
        assert_eq!(load(&tmp.file(), "kind-1"), None);
        assert_eq!(load(&tmp.file(), "kind-2"), Some(snapshot(2, 1)));
        assert_eq!(load(&tmp.file(), "kind-11"), Some(snapshot(11, 1)));
    }

    #[test]
    fn resaving_a_context_replaces_its_snapshot() {
        let tmp = TempDir::new("replace");
        save(&tmp.file(), "kind-a", snapshot(1000, 3)).unwrap();
        save(&tmp.file(), "kind-a", snapshot(2000, 4)).unwrap();

        assert_eq!(load(&tmp.file(), "kind-a"), Some(snapshot(2000, 4)));
    }

    #[test]
    fn clears_one_context_without_touching_the_others() {
        let tmp = TempDir::new("clear-one");
        save(&tmp.file(), "kind-a", snapshot(1000, 3)).unwrap();
        save(&tmp.file(), "kind-b", snapshot(2000, 5)).unwrap();

        clear(&tmp.file(), Some("kind-a")).unwrap();

        assert_eq!(load(&tmp.file(), "kind-a"), None);
        assert_eq!(load(&tmp.file(), "kind-b"), Some(snapshot(2000, 5)));
    }

    #[test]
    fn clears_everything_when_no_context_is_given() {
        let tmp = TempDir::new("clear-all");
        save(&tmp.file(), "kind-a", snapshot(1000, 3)).unwrap();

        clear(&tmp.file(), None).unwrap();

        assert_eq!(load(&tmp.file(), "kind-a"), None);
        assert!(!tmp.file().exists());
    }

    /// The snapshot names contexts and carries warning-event messages, so on a
    /// shared Unix host the file must not be world-readable (same reasoning as
    /// the assistant-history store).
    #[cfg(unix)]
    #[test]
    fn snapshot_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = TempDir::new("perms");
        save(&tmp.file(), "kind-a", snapshot(1000, 3)).unwrap();

        let mode = fs::metadata(tmp.file()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "overview.json must be 0600, got {mode:o}");
    }

    #[test]
    fn clearing_is_idempotent() {
        let tmp = TempDir::new("clear-idempotent");
        clear(&tmp.file(), Some("kind-a")).unwrap();
        clear(&tmp.file(), None).unwrap();
    }
}
