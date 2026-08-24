//! Metrics capabilities (metrics.k8s.io) — pod and node CPU/memory usage.
//! Best-effort: returns an error if metrics-server is not installed.

use std::sync::Arc;
use std::time::Duration;

use srelens_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, DynamicObject, ListParams};
use kube::core::{ApiResource, GroupVersionKind};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

/// Parse a Kubernetes CPU quantity to integer millicores.
pub fn cpu_millicores(s: &str) -> i64 {
    let s = s.trim();
    let parse = |suffix: &str| s.trim_end_matches(suffix).parse::<f64>().unwrap_or(0.0);
    if let Some(rest) = s.strip_suffix('n') {
        (rest.parse::<f64>().unwrap_or(0.0) / 1_000_000.0) as i64
    } else if let Some(rest) = s.strip_suffix('u') {
        (rest.parse::<f64>().unwrap_or(0.0) / 1_000.0) as i64
    } else if s.ends_with('m') {
        parse("m") as i64
    } else {
        (parse("") * 1000.0) as i64
    }
}

/// Parse a Kubernetes memory quantity to integer MiB.
pub fn mem_mib(s: &str) -> i64 {
    let s = s.trim();
    let num = |suffix: &str| s.trim_end_matches(suffix).parse::<f64>().unwrap_or(0.0);
    if s.ends_with("Ki") {
        (num("Ki") / 1024.0) as i64
    } else if s.ends_with("Mi") {
        num("Mi") as i64
    } else if s.ends_with("Gi") {
        (num("Gi") * 1024.0) as i64
    } else if s.ends_with("Ti") {
        (num("Ti") * 1024.0 * 1024.0) as i64
    } else {
        (num("") / 1_048_576.0) as i64
    }
}

fn metrics_api(client: kube::Client, kind: &str, namespaced: bool, namespace: &str) -> Api<DynamicObject> {
    let gvk = GroupVersionKind::gvk("metrics.k8s.io", "v1beta1", kind);
    let ar = ApiResource::from_gvk(&gvk);
    if namespaced && !namespace.is_empty() {
        Api::namespaced_with(client, namespace, &ar)
    } else {
        Api::all_with(client, &ar)
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct NodeMetricsIn {
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct NodeMetric {
    pub name: String,
    #[serde(rename = "cpuMillicores")]
    pub cpu_millicores: i64,
    #[serde(rename = "memoryMiB")]
    pub memory_mib: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct NodeMetricsOut {
    pub metrics: Vec<NodeMetric>,
}

/// `k8s.nodeMetrics` — per-node CPU (millicores) and memory (MiB) usage.
pub fn node_metrics_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<NodeMetricsIn, NodeMetricsOut, _, _>(
        "k8s.nodeMetrics",
        "node CPU/memory usage (requires metrics-server)",
        Annotations::READ_ONLY,
        move |input: NodeMetricsIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let api = metrics_api(client, "NodeMetrics", false, "");
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("node metrics timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                let metrics = list
                    .items
                    .into_iter()
                    .map(|o| {
                        let usage = &o.data["usage"];
                        NodeMetric {
                            name: o.metadata.name.unwrap_or_default(),
                            cpu_millicores: cpu_millicores(usage["cpu"].as_str().unwrap_or("0")),
                            memory_mib: mem_mib(usage["memory"].as_str().unwrap_or("0")),
                        }
                    })
                    .collect();
                Ok(NodeMetricsOut { metrics })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PodMetricsIn {
    pub context: String,
    #[serde(default)]
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct PodMetric {
    pub name: String,
    pub namespace: String,
    #[serde(rename = "cpuMillicores")]
    pub cpu_millicores: i64,
    #[serde(rename = "memoryMiB")]
    pub memory_mib: i64,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct PodMetricsOut {
    pub metrics: Vec<PodMetric>,
}

fn sum_pod_usage(containers: &Value) -> (i64, i64) {
    let mut cpu = 0;
    let mut mem = 0;
    if let Some(arr) = containers.as_array() {
        for c in arr {
            let u = &c["usage"];
            cpu += cpu_millicores(u["cpu"].as_str().unwrap_or("0"));
            mem += mem_mib(u["memory"].as_str().unwrap_or("0"));
        }
    }
    (cpu, mem)
}

/// `k8s.podMetrics` — per-pod CPU (millicores) and memory (MiB) usage.
pub fn pod_metrics_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<PodMetricsIn, PodMetricsOut, _, _>(
        "k8s.podMetrics",
        "pod CPU/memory usage (requires metrics-server)",
        Annotations::READ_ONLY,
        move |input: PodMetricsIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let api = metrics_api(client, "PodMetrics", true, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("pod metrics timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                let metrics = list
                    .items
                    .into_iter()
                    .map(|o| {
                        let (cpu, mem) = sum_pod_usage(&o.data["containers"]);
                        PodMetric {
                            name: o.metadata.name.unwrap_or_default(),
                            namespace: o.metadata.namespace.unwrap_or_default(),
                            cpu_millicores: cpu,
                            memory_mib: mem,
                        }
                    })
                    .collect();
                Ok(PodMetricsOut { metrics })
            }
        },
    )
}

/// Fleet's per-cluster pod count runs during a screen load where up to ten
/// clusters answer in parallel; waiting the full per-request budget
/// (`request_timeout()`, 8s by default) for each one would leave the
/// section visibly unsettled long after the rest of the screen has
/// painted. 3s comfortably covers a metadata-only list on a healthy
/// cluster (sub-second in practice) while staying clearly shorter than a
/// real query's budget, so one slow/unreachable cluster reports
/// "unreachable" quickly rather than holding up its row — or the section.
pub const POD_COUNT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Deserialize, JsonSchema)]
pub struct PodCountIn {
    pub context: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct PodCountOut {
    pub running: i64,
    pub total: i64,
}

/// Count a cluster's pods without listing them: two metadata-only requests
/// (`list_metadata` — no containers, images, or spec/status bodies), one
/// filtered server-side to `status.phase=Running` by field selector, run
/// concurrently under a single timeout budget. A timeout is surfaced as an
/// error, never as a count of zero — a cluster that didn't answer has not
/// told us it has no pods.
async fn count_pods(client: kube::Client, timeout: Duration) -> Result<PodCountOut, String> {
    let api: Api<Pod> = Api::all(client);
    let all = ListParams::default();
    let running_only = ListParams::default().fields("status.phase=Running");
    let total_fut = api.list_metadata(&all);
    let running_fut = api.list_metadata(&running_only);
    let (total, running) = tokio::time::timeout(timeout, futures::future::try_join(total_fut, running_fut))
        .await
        .map_err(|_| "pod count timed out".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(PodCountOut {
        total: total.items.len() as i64,
        running: running.items.len() as i64,
    })
}

/// `k8s.podCount` — running vs total pod counts for one context, for
/// Fleet's per-cluster row. Counted, never listed: see [`count_pods`].
pub fn pod_count_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<PodCountIn, PodCountOut, _, _>(
        "k8s.podCount",
        "running vs total pod counts for a cluster, counted without listing pod bodies",
        Annotations::READ_ONLY,
        move |input: PodCountIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                count_pods(client, POD_COUNT_TIMEOUT)
                    .await
                    .map_err(CapabilityError::Handler)
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parses_cpu_quantities() {
        assert_eq!(cpu_millicores("250m"), 250);
        assert_eq!(cpu_millicores("1"), 1000);
        assert_eq!(cpu_millicores("123456789n"), 123);
        assert_eq!(cpu_millicores("5000u"), 5);
    }

    #[test]
    fn parses_memory_quantities() {
        assert_eq!(mem_mib("131072Ki"), 128);
        assert_eq!(mem_mib("256Mi"), 256);
        assert_eq!(mem_mib("1Gi"), 1024);
    }

    #[test]
    fn capabilities_have_ids() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(node_metrics_capability(cache.clone()).id, "k8s.nodeMetrics");
        assert_eq!(pod_metrics_capability(cache).id, "k8s.podMetrics");
    }

    #[test]
    fn pod_count_capability_has_id() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(pod_count_capability(cache).id, "k8s.podCount");
    }
}

/// Pod-count tests run against a bare, hand-rolled HTTP server rather than a
/// mock K8s API client: `kube::Client::new` needs a `tower::Service`, and
/// this crate carries no test double for one. A raw TCP listener that reads
/// the request line and writes a canned JSON body is enough to prove: two
/// requests go out (one plain, one field-selected), the response bodies are
/// counted rather than re-listed with containers/images, an empty list
/// counts zero, and a server that never answers surfaces as an error — never
/// a zero count.
#[cfg(test)]
mod pod_count_tests {
    use super::*;
    use kube::{Client, Config};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn pod_list_json(names: &[&str]) -> String {
        let items: Vec<Value> = names
            .iter()
            .map(|n| serde_json::json!({ "metadata": { "name": n } }))
            .collect();
        serde_json::json!({ "apiVersion": "v1", "kind": "PodList", "items": items }).to_string()
    }

    /// A server that answers every connection: the plain list gets
    /// `all_body`, and any request whose query string carries
    /// `fieldSelector` (our running-phase request) gets `running_body`.
    async fn fake_pod_server(all_body: String, running_body: String) -> (Client, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let all_body = all_body.clone();
                let running_body = running_body.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let body = if req.contains("fieldSelector") { running_body } else { all_body };
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes()).await;
                });
            }
        });
        let config = Config::new(format!("http://{addr}").parse().unwrap());
        (Client::try_from(config).unwrap(), handle)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn counts_running_and_total_by_phase_without_listing_bodies() {
        let (client, handle) =
            fake_pod_server(pod_list_json(&["a", "b", "c"]), pod_list_json(&["a", "b"])).await;
        let out = count_pods(client, Duration::from_secs(5)).await.unwrap();
        assert_eq!(out.total, 3);
        assert_eq!(out.running, 2);
        handle.abort();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_empty_cluster_counts_zero() {
        let (client, handle) = fake_pod_server(pod_list_json(&[]), pod_list_json(&[])).await;
        let out = count_pods(client, Duration::from_secs(5)).await.unwrap();
        assert_eq!(out.total, 0);
        assert_eq!(out.running, 0);
        handle.abort();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_server_that_never_answers_is_an_error_not_a_zero_count() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            // Accept connections but never write a response — simulates a
            // cluster that is up but not answering in time.
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let _held = stream;
                    tokio::time::sleep(Duration::from_secs(30)).await;
                });
            }
        });
        let config = Config::new(format!("http://{addr}").parse().unwrap());
        let client = Client::try_from(config).unwrap();

        let err = count_pods(client, Duration::from_millis(50)).await.unwrap_err();
        assert!(err.contains("timed out"), "expected a timeout error, got: {err}");

        handle.abort();
    }
}
