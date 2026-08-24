//! `k8s.podCount` — running vs total pod counts for one context, for Fleet's
//! per-cluster row in the overview rail. A count, never a list: this counts
//! pods without shipping their containers, images or spec/status bodies, and
//! it does not depend on metrics-server (see `crate::metrics` for that).

use std::sync::Arc;
use std::time::Duration;

use k8s_openapi::api::core::v1::Pod;
use kube::api::{Api, ListParams};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use srelens_capability::{Annotations, Capability, CapabilityError};

use crate::client_cache::ClientCache;

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
    /// Every pod that is still meant to be running — see [`STILL_RUNNING`]:
    /// `Succeeded` pods are not in it.
    pub total: i64,
}

/// The denominator: every pod EXCEPT the ones that finished successfully.
///
/// A completed Job's pods stay in the cluster until something reaps them, and
/// they are not down — they are done. On the demo cluster the raw counts are
/// 30 Running out of 33 pods and all three of that gap are `Succeeded` Job
/// pods, so a fleet row reading "30/33" says three pods are broken when
/// nothing is; it is the first thing anyone would notice. The figure exists to
/// say how much of the cluster is UP, so the denominator is what is supposed
/// to be up.
///
/// **`Failed` stays counted.** A failed pod genuinely is a problem worth
/// seeing, and it is the one phase whose exclusion would hide a real one.
///
/// Excluded server-side in the selector rather than by a third request
/// subtracted from a plain total: two independently timed counts can disagree
/// when a Job finishes between them, and the subtraction can then go negative.
const STILL_RUNNING: &str = "status.phase!=Succeeded";

/// Count a cluster's pods without listing them: two metadata-only requests
/// (`list_metadata` — no containers, images, or spec/status bodies), each
/// filtered server-side by field selector — one to `status.phase=Running`, the
/// other to everything [`STILL_RUNNING`] — run concurrently under a single
/// timeout budget. A timeout is surfaced as an error, never as a count of
/// zero: a cluster that didn't answer has not told us it has no pods.
async fn count_pods(client: kube::Client, timeout: Duration) -> Result<PodCountOut, String> {
    let api: Api<Pod> = Api::all(client);
    let all = ListParams::default().fields(STILL_RUNNING);
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
    fn pod_count_capability_has_id() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(pod_count_capability(cache).id, "k8s.podCount");
    }
}

/// Pod-count tests run against a bare, hand-rolled HTTP server rather than a
/// mock K8s API client: `kube::Client::new` needs a `tower::Service`, and
/// this crate carries no test double for one. A raw TCP listener that reads
/// the request line and writes a canned JSON body is enough to prove: two
/// requests go out (one plain, one field-selected), each asking for the
/// metadata-only representation — not just that the resulting counts are
/// right, since a full `Api::list` would produce the same counts from the
/// same fixture while shipping every pod's spec/status across the wire — an
/// empty list counts zero, and a server that never answers surfaces as an
/// error, never a zero count.
#[cfg(test)]
mod pod_count_tests {
    use super::*;
    use kube::{Client, Config};
    use std::sync::Mutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn pod_list_json(names: &[&str]) -> String {
        let items: Vec<serde_json::Value> = names
            .iter()
            .map(|n| serde_json::json!({ "metadata": { "name": n } }))
            .collect();
        serde_json::json!({ "apiVersion": "v1", "kind": "PodList", "items": items }).to_string()
    }

    /// A server that answers every connection: the request selecting
    /// `status.phase=Running` gets `running_body`, and the other — our total,
    /// which selects everything that is not `Succeeded` — gets `total_body`.
    /// Returns the client, the listener task's handle, and a log of every
    /// request as `(request line, Accept header)` so a test can inspect *how*
    /// it asked, not just what it got back.
    async fn fake_pod_server(
        total_body: String,
        running_body: String,
    ) -> (Client, tokio::task::JoinHandle<()>, Arc<Mutex<Vec<(String, String)>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_task = seen.clone();
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let all_body = total_body.clone();
                let running_body = running_body.clone();
                let seen = seen_task.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let line = req.lines().next().unwrap_or("").to_string();
                    let accept = req
                        .lines()
                        .find(|line| line.to_ascii_lowercase().starts_with("accept:"))
                        .unwrap_or("")
                        .to_string();
                    let running = line.contains("Running");
                    seen.lock().unwrap().push((line, accept));
                    let body = if running { running_body } else { all_body };
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
        (Client::try_from(config).unwrap(), handle, seen)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn counts_running_and_total_using_metadata_only_requests() {
        let (client, handle, seen) =
            fake_pod_server(pod_list_json(&["a", "b", "c"]), pod_list_json(&["a", "b"])).await;
        let out = count_pods(client, Duration::from_secs(5)).await.unwrap();
        assert_eq!(out.total, 3);
        assert_eq!(out.running, 2);

        // The property this capability exists for: both requests must ask
        // for the metadata-only representation. `Api::list` would produce
        // identical counts from this fixture while shipping every pod's
        // full body — this is the guard that makes reaching for it a
        // failing test, not a silent regression.
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.len(), 2, "expected exactly two requests, got {seen:?}");
        for (_, accept) in &seen {
            assert!(
                accept.contains("PartialObjectMetadataList"),
                "expected a metadata-only Accept header, got: {accept}"
            );
        }
        handle.abort();
    }

    /// A finished Job's pods stay in the cluster until something reaps them,
    /// and they are not down — they are done. On the demo cluster the raw
    /// counts are 30 Running out of 33 pods, and all three of that gap are
    /// `Succeeded` Job pods: a rail reading "30/33 running" says three pods
    /// are broken when nothing is. The figure exists to say how much of the
    /// cluster is UP, so the denominator is every pod that is still meant to
    /// be running.
    ///
    /// `Failed` deliberately stays counted. A failed pod genuinely is a
    /// problem, and the one phase whose exclusion would hide a real one.
    ///
    /// The exclusion is server-side, in the field selector, rather than a
    /// third request subtracted from the total: subtracting two independently
    /// timed counts can go negative when a Job finishes between them.
    #[tokio::test(flavor = "multi_thread")]
    async fn the_total_leaves_out_pods_that_finished_successfully() {
        let (client, handle, seen) =
            fake_pod_server(pod_list_json(&["a", "b", "c"]), pod_list_json(&["a", "b", "c"])).await;
        let out = count_pods(client, Duration::from_secs(5)).await.unwrap();
        assert_eq!(out.total, 3);

        let seen = seen.lock().unwrap().clone();
        let total_request = seen
            .iter()
            .map(|(line, _)| line.clone())
            .find(|line| !line.contains("Running"))
            .expect("expected a request for the total");
        assert!(
            total_request.contains("Succeeded"),
            "the total must exclude Succeeded pods server-side, asked: {total_request}"
        );
        // Not an equality selector: `status.phase=Succeeded` would count only
        // the finished pods, which is the opposite of what is wanted.
        assert!(
            total_request.contains("%21%3D") || total_request.contains("!="),
            "expected a not-equals selector, asked: {total_request}"
        );
        handle.abort();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_empty_cluster_counts_zero() {
        let (client, handle, _) = fake_pod_server(pod_list_json(&[]), pod_list_json(&[])).await;
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
