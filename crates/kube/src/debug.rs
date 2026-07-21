//! Ephemeral debug containers and node debug shells (#17).
//!
//! Two destructive, confirm-gated capabilities that create a target you can then
//! open an interactive shell into (via the existing exec pipeline):
//!
//! - `k8s.debugPod` patches an ephemeral debug container onto a running pod
//!   (optionally sharing another container's process namespace) and returns its
//!   name — exec into that name for a debugger shell beside a distroless app.
//! - `k8s.createNodeDebugPod` creates a privileged pod pinned to a node that
//!   `nsenter`s into the host namespaces; the caller execs into it and deletes
//!   it (via `k8s.deletePod`) when the shell closes.
//!
//! The JSON-building halves are pure and unit-tested; the API calls are covered
//! by the kind integration suite.

use std::sync::Arc;

use k8s_openapi::api::core::v1::Pod;
use kube::api::{Patch, PatchParams, PostParams};
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use srelens_capability::{Annotations, Capability, CapabilityError};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

/// A short, DNS-safe suffix so repeated debugs don't collide on the ephemeral
/// container name (a name can't be reused once added to a pod).
fn debug_container_name() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("debugger-{:05x}", nanos & 0xf_ffff)
}

/// The strategic-merge patch that adds one ephemeral container to a pod. A
/// strategic merge concatenates the `ephemeralContainers` list, so existing
/// debuggers are preserved. `stdin`/`tty` are set so a shell can attach.
pub fn ephemeral_patch(name: &str, image: &str, target_container: Option<&str>) -> Value {
    let mut container = json!({
        "name": name,
        "image": image,
        "stdin": true,
        "tty": true,
        "command": ["/bin/sh"],
    });
    if let Some(target) = target_container.filter(|t| !t.is_empty()) {
        container["targetContainerName"] = json!(target);
    }
    json!({ "spec": { "ephemeralContainers": [container] } })
}

/// The privileged, host-namespaced debug pod spec pinned to `node`. It shares
/// the host PID/network/IPC namespaces and just stays alive; the caller then
/// `exec`s `nsenter --target 1 …` into it to enter PID 1's namespaces for a real
/// host shell (a pod-that-nsenters-on-start would race the exec and 500). The
/// keep-alive entrypoint has no dependencies beyond the image's shell, so the
/// pod reaches Running reliably. `restartPolicy: Never` + tolerations so it
/// schedules on any (even tainted) node and doesn't restart after exit.
pub fn node_debug_pod_spec(node: &str, image: &str) -> Value {
    json!({
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": { "generateName": "srelens-node-debug-" },
        "spec": {
            "nodeName": node,
            "hostPID": true,
            "hostNetwork": true,
            "hostIPC": true,
            "restartPolicy": "Never",
            "tolerations": [{ "operator": "Exists" }],
            "containers": [{
                "name": "debug",
                "image": image,
                "securityContext": { "privileged": true },
                "command": ["sh", "-c", "while true; do sleep 3600; done"],
            }],
        }
    })
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DebugPodIn {
    pub context: String,
    pub namespace: String,
    pub pod: String,
    /// The debugger image (e.g. `busybox`, `nicolaka/netshoot`).
    pub image: String,
    /// Optional container whose process namespace the debugger shares, so its
    /// processes and filesystem (`/proc/1/root`) are visible.
    #[serde(default)]
    pub target_container: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct DebugPodOut {
    /// The ephemeral container that was added — exec into this for a shell.
    pub container: String,
}

/// `k8s.debugPod` — attach an ephemeral debug container to a running pod.
pub fn debug_pod_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<DebugPodIn, DebugPodOut, _, _>(
        "k8s.debugPod",
        "attach an ephemeral debug container to a running pod and return its \
         name; exec into that container for a debugger shell (destructive)",
        Annotations::DESTRUCTIVE,
        move |input: DebugPodIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = Api::namespaced(client, &input.namespace);
                let name = debug_container_name();
                let patch = ephemeral_patch(&name, &input.image, input.target_container.as_deref());
                tokio::time::timeout(
                    request_timeout(),
                    api.patch_ephemeral_containers(&input.pod, &PatchParams::default(), &Patch::Strategic(patch)),
                )
                .await
                .map_err(|_| CapabilityError::Handler("debug pod timed out".into()))?
                .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(DebugPodOut { container: name })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct NodeDebugIn {
    pub context: String,
    pub node: String,
    /// Image for the debug pod (needs `nsenter`); defaults to `busybox`.
    #[serde(default)]
    pub image: Option<String>,
    /// Namespace to create the debug pod in; defaults to `default`.
    #[serde(default)]
    pub namespace: Option<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct NodeDebugOut {
    pub namespace: String,
    pub pod: String,
}

/// `k8s.createNodeDebugPod` — create a privileged host-namespaced pod on a node.
/// The caller execs into it and deletes it (via `k8s.deletePod`) when done.
pub fn node_debug_pod_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<NodeDebugIn, NodeDebugOut, _, _>(
        "k8s.createNodeDebugPod",
        "create a privileged debug pod on a node that nsenters into the host \
         namespaces; delete it when the shell closes (destructive)",
        Annotations::DESTRUCTIVE,
        move |input: NodeDebugIn| {
            let cache = cache.clone();
            async move {
                let namespace = input.namespace.unwrap_or_else(|| "default".to_string());
                let image = input.image.unwrap_or_else(|| "busybox".to_string());
                let spec = node_debug_pod_spec(&input.node, &image);
                let pod: Pod = serde_json::from_value(spec)
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = Api::namespaced(client, &namespace);
                let created = tokio::time::timeout(
                    request_timeout(),
                    api.create(&PostParams::default(), &pod),
                )
                .await
                .map_err(|_| CapabilityError::Handler("create node debug pod timed out".into()))?
                .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                let pod = created
                    .metadata
                    .name
                    .ok_or_else(|| CapabilityError::Handler("created pod has no name".into()))?;
                Ok(NodeDebugOut { namespace, pod })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ephemeral_patch_sets_stdin_tty_and_optional_target() {
        let p = ephemeral_patch("debugger-1", "busybox", None);
        let c = &p["spec"]["ephemeralContainers"][0];
        assert_eq!(c["name"], "debugger-1");
        assert_eq!(c["image"], "busybox");
        assert_eq!(c["stdin"], true);
        assert_eq!(c["tty"], true);
        assert!(c.get("targetContainerName").is_none());

        let p = ephemeral_patch("debugger-2", "netshoot", Some("app"));
        assert_eq!(p["spec"]["ephemeralContainers"][0]["targetContainerName"], "app");
    }

    #[test]
    fn ephemeral_patch_deserializes_into_a_pod() {
        // The strategic patch body must be a valid partial Pod.
        let p = ephemeral_patch("debugger-3", "busybox", Some("web"));
        let pod: Pod = serde_json::from_value(p).expect("valid pod patch");
        let ec = pod.spec.unwrap().ephemeral_containers.unwrap();
        assert_eq!(ec[0].name, "debugger-3");
        assert_eq!(ec[0].target_container_name.as_deref(), Some("web"));
    }

    #[test]
    fn node_debug_pod_spec_is_privileged_host_namespaced_and_pinned() {
        let spec = node_debug_pod_spec("node-1", "busybox");
        let pod: Pod = serde_json::from_value(spec).expect("valid pod");
        let s = pod.spec.unwrap();
        assert_eq!(s.node_name.as_deref(), Some("node-1"));
        assert_eq!(s.host_pid, Some(true));
        assert_eq!(s.host_network, Some(true));
        let c = &s.containers[0];
        assert_eq!(c.security_context.as_ref().unwrap().privileged, Some(true));
        // The pod just stays alive; nsenter is run via exec, not the entrypoint.
        assert!(c.command.as_ref().unwrap().iter().any(|a| a.contains("sleep")));
    }

    #[test]
    fn debug_container_name_is_dns_safe_and_prefixed() {
        let n = debug_container_name();
        assert!(n.starts_with("debugger-"));
        assert!(n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'));
    }
}
