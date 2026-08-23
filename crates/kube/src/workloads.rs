//! Workload-listing capabilities backed by kube-rs: `k8s.listNamespaces` and
//! `k8s.listPods` for a connected context.

use std::sync::Arc;

use srelens_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::{Namespace, Pod};
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListNamespacesIn {
    pub context: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListNamespacesOut {
    pub namespaces: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListPodsIn {
    pub context: String,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct PodSummary {
    pub name: String,
    pub namespace: String,
    pub phase: String,
    pub ready: String,
    pub restarts: i32,
    pub node: String,
    pub age: String,
    /// Container image(s) the pod runs, e.g. `acme/checkout-api:118a7e`.
    /// A pod with several containers joins them as `"img-a, img-b"`; a pod
    /// with no containers (or no status yet) is `""`.
    pub image: String,
    /// Why a container is waiting, when one is — `CrashLoopBackOff`,
    /// `ImagePullBackOff`, `CreateContainerConfigError`, `ContainerCreating`.
    ///
    /// `phase` alone cannot tell a healthy pod from a crash-looping one: a pod
    /// whose only container is restarting in a back-off loop still reports
    /// `Running`, so a list that reads nothing but the phase draws it green.
    /// This carries the fact the phase omits; what it *means* — which reasons
    /// are a failure and which are a pod on its way up — is decided once, in
    /// `podStatus` in `@srelens/core`, not here and not twice.
    ///
    /// The first waiting reason across the pod's containers, or `""` when none
    /// is waiting.
    #[serde(rename = "waitingReason")]
    pub waiting_reason: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListPodsOut {
    pub pods: Vec<PodSummary>,
}

fn handler_err(e: impl ToString) -> CapabilityError {
    CapabilityError::Handler(e.to_string())
}

/// `k8s.listNamespaces` — list namespace names in a connected context.
pub fn list_namespaces_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListNamespacesIn, ListNamespacesOut, _, _>(
        "k8s.listNamespaces",
        "list namespaces in a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListNamespacesIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Namespace> = Api::all(client);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list namespaces timed out".into()))?
                    .map_err(handler_err)?;
                let namespaces = list
                    .items
                    .into_iter()
                    .filter_map(|ns| ns.metadata.name)
                    .collect();
                Ok(ListNamespacesOut { namespaces })
            }
        },
    )
}

/// Summarise a pod's ready count, total restarts, and phase.
pub(crate) fn summarise_pod(pod: Pod) -> PodSummary {
    let name = pod.metadata.name.clone().unwrap_or_default();
    let namespace = pod.metadata.namespace.clone().unwrap_or_default();
    let node = pod
        .spec
        .as_ref()
        .and_then(|s| s.node_name.clone())
        .unwrap_or_default();
    let phase = pod
        .status
        .as_ref()
        .and_then(|s| s.phase.clone())
        .unwrap_or_else(|| "Unknown".into());

    let statuses = pod
        .status
        .as_ref()
        .and_then(|s| s.container_statuses.as_ref());
    let (ready_count, restarts) = match statuses {
        Some(cs) => (
            cs.iter().filter(|c| c.ready).count(),
            cs.iter().map(|c| c.restart_count).sum(),
        ),
        None => (0, 0),
    };
    let total = statuses.map(|cs| cs.len()).unwrap_or(0);
    // One row shows one pod, so several containers are joined into a single
    // string — same shape as the multi-value `ports` summaries elsewhere in
    // this crate (e.g. ingresses' "80, 443"). Init containers are excluded:
    // they run to completion before the pod is "running" the images that
    // matter for this column.
    let image = statuses
        .map(|cs| {
            cs.iter()
                .map(|c| c.image.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();

    // Reported raw, in container order, exactly as `image` is: the first
    // container with something to say. Init containers are excluded for the
    // same reason they are excluded there.
    let waiting_reason = statuses
        .and_then(|cs| {
            cs.iter()
                .find_map(|c| c.state.as_ref()?.waiting.as_ref()?.reason.clone())
        })
        .unwrap_or_default();

    PodSummary {
        name,
        namespace,
        phase,
        ready: format!("{ready_count}/{total}"),
        restarts,
        node,
        age: crate::humanize_age(pod.metadata.creation_timestamp.as_ref()),
        image,
        waiting_reason,
    }
}

/// `k8s.listPods` — list pods in a namespace of a connected context.
pub fn list_pods_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListPodsIn, ListPodsOut, _, _>(
        "k8s.listPods",
        "list pods in a namespace of a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListPodsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list pods timed out".into()))?
                    .map_err(handler_err)?;
                let pods = list.items.into_iter().map(summarise_pod).collect();
                Ok(ListPodsOut { pods })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PodsForSelectorIn {
    pub context: String,
    pub namespace: String,
    /// Equality label selector as a map, e.g. `{ "app": "web" }`.
    pub selector: std::collections::BTreeMap<String, String>,
}

/// Build a kube equality label selector string ("k1=v1,k2=v2") from a map.
pub(crate) fn label_selector(selector: &std::collections::BTreeMap<String, String>) -> String {
    selector
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",")
}

/// `k8s.podsForSelector` — pods in a namespace matching a label selector, used
/// to show the pods a workload (Deployment/StatefulSet) manages.
pub fn pods_for_selector_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<PodsForSelectorIn, ListPodsOut, _, _>(
        "k8s.podsForSelector",
        "list pods matching a label selector (a workload's managed pods)",
        Annotations::READ_ONLY,
        move |input: PodsForSelectorIn| {
            let cache = cache.clone();
            async move {
                // An empty selector would match every pod; return nothing instead.
                if input.selector.is_empty() {
                    return Ok(ListPodsOut { pods: vec![] });
                }
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Pod> = crate::scoped_api(client, &input.namespace);
                let params = ListParams::default().labels(&label_selector(&input.selector));
                let list = tokio::time::timeout(request_timeout(), api.list(&params))
                    .await
                    .map_err(|_| CapabilityError::Handler("list pods timed out".into()))?
                    .map_err(handler_err)?;
                let pods = list.items.into_iter().map(summarise_pod).collect();
                Ok(ListPodsOut { pods })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::core::v1::{
        ContainerState, ContainerStateRunning, ContainerStateWaiting, ContainerStatus, PodSpec,
        PodStatus,
    };

    #[test]
    fn capabilities_have_expected_ids() {
        use std::path::PathBuf;
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(
            list_namespaces_capability(cache.clone()).id,
            "k8s.listNamespaces"
        );
        assert_eq!(list_pods_capability(cache.clone()).id, "k8s.listPods");
        assert_eq!(pods_for_selector_capability(cache).id, "k8s.podsForSelector");
    }

    #[test]
    fn builds_label_selector_string() {
        let mut m = std::collections::BTreeMap::new();
        m.insert("app".to_string(), "web".to_string());
        m.insert("tier".to_string(), "frontend".to_string());
        assert_eq!(label_selector(&m), "app=web,tier=frontend");
    }

    #[test]
    fn summarises_ready_and_restarts() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("web-1".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            spec: Some(PodSpec {
                node_name: Some("node-a".into()),
                ..Default::default()
            }),
            status: Some(PodStatus {
                phase: Some("Running".into()),
                container_statuses: Some(vec![
                    ContainerStatus {
                        ready: true,
                        restart_count: 1,
                        ..Default::default()
                    },
                    ContainerStatus {
                        ready: false,
                        restart_count: 2,
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            }),
        };
        let s = summarise_pod(pod);
        assert_eq!(s.name, "web-1");
        assert_eq!(s.phase, "Running");
        assert_eq!(s.ready, "1/2");
        assert_eq!(s.restarts, 3);
        assert_eq!(s.node, "node-a");
    }

    #[test]
    fn summarises_pod_with_no_status() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("pending".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        let s = summarise_pod(pod);
        assert_eq!(s.phase, "Unknown");
        assert_eq!(s.ready, "0/0");
        assert_eq!(s.restarts, 0);
        assert_eq!(s.image, "");
    }

    #[test]
    fn reports_the_waiting_reason_a_running_phase_hides() {
        // The defect this field exists for: a pod whose only container is in
        // CrashLoopBackOff still reports phase "Running", so a row that reads
        // nothing but the phase draws it green and healthy.
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("checkout-api".into()),
                ..Default::default()
            },
            status: Some(PodStatus {
                phase: Some("Running".into()),
                container_statuses: Some(vec![ContainerStatus {
                    name: "api".into(),
                    ready: false,
                    restart_count: 7,
                    state: Some(ContainerState {
                        waiting: Some(ContainerStateWaiting {
                            reason: Some("CrashLoopBackOff".into()),
                            message: Some("back-off 5m0s restarting failed container".into()),
                        }),
                        ..Default::default()
                    }),
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let s = summarise_pod(pod);
        assert_eq!(s.phase, "Running");
        assert_eq!(s.waiting_reason, "CrashLoopBackOff");
    }

    #[test]
    fn leaves_the_waiting_reason_empty_when_nothing_is_waiting() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("web-1".into()),
                ..Default::default()
            },
            status: Some(PodStatus {
                phase: Some("Running".into()),
                container_statuses: Some(vec![ContainerStatus {
                    name: "web".into(),
                    ready: true,
                    restart_count: 0,
                    state: Some(ContainerState {
                        running: Some(ContainerStateRunning { started_at: None }),
                        ..Default::default()
                    }),
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(summarise_pod(pod).waiting_reason, "");
    }

    #[test]
    fn takes_the_first_waiting_container_of_several() {
        // Container order, exactly as `image` joins in container order: one
        // row shows one reason, and it is the first one the pod reports.
        let waiting = |reason: &str| ContainerStatus {
            name: reason.into(),
            ready: false,
            restart_count: 0,
            state: Some(ContainerState {
                waiting: Some(ContainerStateWaiting {
                    reason: Some(reason.into()),
                    message: None,
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("web-1".into()),
                ..Default::default()
            },
            status: Some(PodStatus {
                phase: Some("Pending".into()),
                container_statuses: Some(vec![
                    ContainerStatus {
                        name: "sidecar".into(),
                        ready: true,
                        restart_count: 0,
                        ..Default::default()
                    },
                    waiting("ImagePullBackOff"),
                    waiting("CreateContainerConfigError"),
                ]),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(summarise_pod(pod).waiting_reason, "ImagePullBackOff");
    }

    #[test]
    fn summarises_single_container_image() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("web-1".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            status: Some(PodStatus {
                phase: Some("Running".into()),
                container_statuses: Some(vec![ContainerStatus {
                    name: "web".into(),
                    image: "redis:7.4-alpine".into(),
                    ready: true,
                    restart_count: 0,
                    ..Default::default()
                }]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let s = summarise_pod(pod);
        assert_eq!(s.image, "redis:7.4-alpine");
    }

    #[test]
    fn summarises_multi_container_image_as_joined_list() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("web-1".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            status: Some(PodStatus {
                phase: Some("Running".into()),
                container_statuses: Some(vec![
                    ContainerStatus {
                        name: "app".into(),
                        image: "acme/checkout-api:118a7e".into(),
                        ready: true,
                        restart_count: 0,
                        ..Default::default()
                    },
                    ContainerStatus {
                        name: "sidecar".into(),
                        image: "envoyproxy/envoy:v1.30".into(),
                        ready: true,
                        restart_count: 0,
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let s = summarise_pod(pod);
        assert_eq!(s.image, "acme/checkout-api:118a7e, envoyproxy/envoy:v1.30");
    }

    #[test]
    fn summarises_pod_with_no_containers_has_empty_image() {
        let pod = Pod {
            metadata: kube::core::ObjectMeta {
                name: Some("empty".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            status: Some(PodStatus {
                phase: Some("Pending".into()),
                container_statuses: Some(vec![]),
                ..Default::default()
            }),
            ..Default::default()
        };
        let s = summarise_pod(pod);
        assert_eq!(s.image, "");
    }
}
