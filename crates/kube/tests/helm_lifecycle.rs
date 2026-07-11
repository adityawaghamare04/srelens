//! End-to-end Helm lifecycle against a real cluster with the real `helm` binary.
//!
//! This is the acceptance test for #14: install -> upgrade -> rollback ->
//! uninstall, driven through the actual capability handlers (the same code path
//! the MCP tools use), with NON-EMPTY VALUES at every step. The unit suites
//! cannot cover this: they never spawn helm, so they cannot catch a temp
//! values-file that is deleted before helm reads it (a real regression that
//! once passed a fully green suite).
//!
//! Ignored by default — needs a cluster and helm on PATH. Run with:
//!
//! ```sh
//! kind create cluster --name srelens-helm-e2e
//! cargo test -p srelens-kube --test helm_lifecycle -- --ignored --nocapture
//! ```
//!
//! Override the context with `SRELENS_E2E_CONTEXT`.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use srelens_capability::Capability;
use srelens_kube::client_cache::ClientCache;
use srelens_kube::helm::{get_helm_release_capability, list_helm_releases_capability};
use srelens_kube::helm_cli::*;

const NS: &str = "srelens-e2e";
const RELEASE: &str = "e2e-demo";

fn context() -> String {
    std::env::var("SRELENS_E2E_CONTEXT").unwrap_or_else(|_| "kind-srelens-helm-e2e".to_string())
}

fn kubeconfig_paths() -> Vec<PathBuf> {
    if let Ok(kc) = std::env::var("KUBECONFIG") {
        return std::env::split_paths(&kc).collect();
    }
    let home = std::env::var("HOME").expect("HOME");
    vec![PathBuf::from(home).join(".kube/config")]
}

fn cache() -> Arc<ClientCache> {
    ClientCache::new_many(kubeconfig_paths())
}

/// Invoke a capability the way the MCP/Tauri layers do: JSON in, JSON out.
async fn call(cap: &Capability, input: Value) -> Value {
    match (cap.handler)(input.clone()).await {
        Ok(v) => v,
        Err(e) => panic!("capability {} failed on {input}: {e:?}", cap.id),
    }
}

/// A self-contained chart whose rendered ConfigMap echoes `.Values.message`, so
/// we can prove the user's values actually reached helm.
fn write_chart(dir: &PathBuf) {
    std::fs::create_dir_all(dir.join("templates")).unwrap();
    std::fs::write(
        dir.join("Chart.yaml"),
        "apiVersion: v2\nname: e2e-demo\nversion: 0.1.0\n",
    )
    .unwrap();
    std::fs::write(dir.join("values.yaml"), "message: default-from-chart\n").unwrap();
    std::fs::write(
        dir.join("templates/cm.yaml"),
        "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: e2e-demo\ndata:\n  message: {{ .Values.message | quote }}\n",
    )
    .unwrap();
}

/// Temp files matching our prefix that exist right now (leak detection).
fn helm_temp_files() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return vec![];
    };
    entries
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.starts_with("srelens-helm-").then_some(n)
        })
        .collect()
}

#[tokio::test]
#[ignore = "needs a live cluster and helm on PATH"]
async fn full_helm_lifecycle_with_values() {
    let ctx = context();
    let cache = cache();
    let before = helm_temp_files();

    // Chart on disk (no network, no repo needed for the lifecycle itself).
    let chart_dir = std::env::temp_dir().join(format!("srelens-e2e-chart-{}", std::process::id()));
    write_chart(&chart_dir);
    let chart = chart_dir.to_string_lossy().to_string();

    // helm must be present.
    let v = call(&helm_version_capability(cache.clone()), json!({"context": ctx})).await;
    let helm_version = v["version"].as_str().unwrap_or_default().to_string();
    assert!(!helm_version.is_empty(), "helm version should be reported");
    println!("helm: {helm_version}");

    // --- template (the render preview) honours values -----------------------
    let t = call(
        &helm_template_capability(cache.clone()),
        json!({
            "context": ctx, "name": RELEASE, "chart": chart,
            "namespace": NS, "values": "message: from-template\n"
        }),
    )
    .await;
    let rendered = t["output"].as_str().unwrap_or_default();
    assert!(
        rendered.contains("from-template"),
        "helm template must render the supplied values, got:\n{rendered}"
    );
    println!("template: values honoured");

    // --- install WITH VALUES ------------------------------------------------
    call(
        &helm_install_capability(cache.clone()),
        json!({
            "context": ctx, "name": RELEASE, "chart": chart,
            "namespace": NS, "values": "message: hello-from-install\n"
        }),
    )
    .await;

    let rel = call(
        &get_helm_release_capability(cache.clone()),
        json!({"context": ctx, "namespace": NS, "name": RELEASE}),
    )
    .await;
    assert_eq!(rel["revision"], 1, "install should be revision 1");
    // THE regression guard: the values temp file must have survived long enough
    // for helm to read it.
    assert!(
        rel["valuesYaml"]
            .as_str()
            .unwrap_or_default()
            .contains("hello-from-install"),
        "install must apply the user's values, got: {}",
        rel["valuesYaml"]
    );
    assert!(
        rel["manifest"]
            .as_str()
            .unwrap_or_default()
            .contains("hello-from-install"),
        "the rendered manifest must reflect the user's values"
    );
    println!("install: revision 1, values applied");

    // The release shows up in a namespace-scoped listing.
    let list = call(
        &list_helm_releases_capability(cache.clone()),
        json!({"context": ctx, "namespace": NS}),
    )
    .await;
    assert!(
        list["releases"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["name"] == RELEASE),
        "namespace-scoped list must contain the release"
    );
    println!("list: release visible in namespace-scoped listing");

    // --- upgrade WITH DIFFERENT VALUES -------------------------------------
    call(
        &helm_upgrade_capability(cache.clone()),
        json!({
            "context": ctx, "name": RELEASE, "chart": chart,
            "namespace": NS, "values": "message: upgraded-value\n"
        }),
    )
    .await;

    let rel = call(
        &get_helm_release_capability(cache.clone()),
        json!({"context": ctx, "namespace": NS, "name": RELEASE}),
    )
    .await;
    assert_eq!(rel["revision"], 2, "upgrade should produce revision 2");
    assert!(
        rel["valuesYaml"]
            .as_str()
            .unwrap_or_default()
            .contains("upgraded-value"),
        "upgrade must apply the NEW values, got: {}",
        rel["valuesYaml"]
    );
    println!("upgrade: revision 2, new values applied");

    // --- rollback -----------------------------------------------------------
    call(
        &helm_rollback_capability(cache.clone()),
        json!({"context": ctx, "name": RELEASE, "namespace": NS, "revision": 1}),
    )
    .await;

    let rel = call(
        &get_helm_release_capability(cache.clone()),
        json!({"context": ctx, "namespace": NS, "name": RELEASE}),
    )
    .await;
    assert_eq!(rel["revision"], 3, "rollback creates a new revision");
    assert!(
        rel["valuesYaml"]
            .as_str()
            .unwrap_or_default()
            .contains("hello-from-install"),
        "rollback must restore revision 1's values, got: {}",
        rel["valuesYaml"]
    );
    println!("rollback: back to revision 1's values (as revision 3)");

    // --- uninstall ----------------------------------------------------------
    call(
        &helm_uninstall_capability(cache.clone()),
        json!({"context": ctx, "name": RELEASE, "namespace": NS}),
    )
    .await;

    let list = call(
        &list_helm_releases_capability(cache.clone()),
        json!({"context": ctx, "namespace": NS}),
    )
    .await;
    assert!(
        !list["releases"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["name"] == RELEASE),
        "uninstall must remove the release"
    );
    println!("uninstall: release gone");

    // --- no credential/values temp files left behind ------------------------
    let leaked: Vec<_> = helm_temp_files()
        .into_iter()
        .filter(|f| !before.contains(f))
        .collect();
    assert!(
        leaked.is_empty(),
        "helm ops leaked temp files (kubeconfig/values): {leaked:?}"
    );
    println!("cleanup: no temp kubeconfig/values files leaked");

    let _ = std::fs::remove_dir_all(&chart_dir);
}

/// Flag-like inputs are rejected before helm ever runs (MCP-reachable writes).
#[tokio::test]
#[ignore = "needs a live cluster and helm on PATH"]
async fn rejects_flag_like_inputs() {
    let ctx = context();
    let cache = cache();

    let install = helm_install_capability(cache.clone());
    let err = (install.handler)(json!({
        "context": ctx, "name": "--evil", "chart": "./x", "namespace": NS, "values": ""
    }))
    .await
    .expect_err("a flag-like release name must be rejected");
    println!("rejected flag-like name: {err:?}");

    let rollback = helm_rollback_capability(cache);
    let err = (rollback.handler)(json!({
        "context": ctx, "name": "x", "namespace": NS, "revision": -1
    }))
    .await
    .expect_err("a negative revision must be rejected");
    println!("rejected negative revision: {err:?}");
}
