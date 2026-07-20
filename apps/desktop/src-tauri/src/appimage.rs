//! AppImage runtime quirks.
//!
//! The AppImage bundles its own GLib (built on the release runner, currently
//! 2.72). GLib's GIO scans a compiled-in module directory — the *host's*
//! `/usr/lib/<arch>/gio/modules` — and the AppImage's GTK AppRun hook only
//! *adds* the bundled dir via `GIO_EXTRA_MODULES` rather than replacing the
//! search path. So on a host newer than the build runner, the bundled GLib
//! tries to load the host's gvfs modules, which reference symbols it doesn't
//! have (e.g. `g_task_set_static_name`, added in GLib 2.76), and startup prints
//! `undefined symbol` / `Failed to load module` for every one.
//!
//! Pointing `GIO_MODULE_DIR` at the bundled dir makes the bundled GLib scan
//! only its own compatible modules (the bundled TLS backend still loads, so
//! HTTPS keeps working; host gvfs — already unusable here — is simply not
//! scanned). The bundled dir is exactly what the GTK hook already exposes as
//! `GIO_EXTRA_MODULES`, so we reuse it and stay arch-correct without hardcoding
//! a multiarch tuple.

/// Decide what `GIO_MODULE_DIR` should be set to, given the current
/// `GIO_EXTRA_MODULES` and any existing `GIO_MODULE_DIR`. Returns `None` when
/// nothing should change: outside an AppImage (`GIO_EXTRA_MODULES` unset/empty),
/// or when the user already pinned `GIO_MODULE_DIR` themselves.
pub fn gio_module_dir_for_appimage(
    gio_extra_modules: Option<&str>,
    existing_gio_module_dir: Option<&str>,
) -> Option<String> {
    // Respect an explicit override (including one deliberately set to empty).
    if existing_gio_module_dir.is_some() {
        return None;
    }
    // GIO_MODULE_DIR names a single directory; GIO_EXTRA_MODULES is a
    // `:`-separated list. The GTK hook sets one entry — take the first.
    let dir = gio_extra_modules?.split(':').next().unwrap_or("");
    if dir.is_empty() {
        return None;
    }
    Some(dir.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outside_an_appimage_changes_nothing() {
        assert_eq!(gio_module_dir_for_appimage(None, None), None);
    }

    #[test]
    fn empty_extra_modules_changes_nothing() {
        assert_eq!(gio_module_dir_for_appimage(Some(""), None), None);
    }

    #[test]
    fn appimage_points_module_dir_at_the_bundled_dir() {
        assert_eq!(
            gio_module_dir_for_appimage(
                Some("/tmp/.mount_x/usr/lib/x86_64-linux-gnu/gio/modules"),
                None,
            ),
            Some("/tmp/.mount_x/usr/lib/x86_64-linux-gnu/gio/modules".to_string()),
        );
    }

    #[test]
    fn a_user_set_module_dir_is_left_alone() {
        assert_eq!(
            gio_module_dir_for_appimage(Some("/tmp/.mount_x/usr/lib/gio/modules"), Some("/opt/gio")),
            None,
        );
        // Even an explicitly-empty override is respected, not clobbered.
        assert_eq!(
            gio_module_dir_for_appimage(Some("/tmp/.mount_x/usr/lib/gio/modules"), Some("")),
            None,
        );
    }

    #[test]
    fn a_list_valued_extra_modules_yields_a_single_dir() {
        assert_eq!(
            gio_module_dir_for_appimage(Some("/appdir/gio/modules:/other/dir"), None),
            Some("/appdir/gio/modules".to_string()),
        );
    }
}
