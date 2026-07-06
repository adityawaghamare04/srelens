//! Live resource watching via kube-rs `watcher`, generic over the summary
//! type. Maintains an in-memory map and emits a full sorted snapshot on every
//! change, so the UI can replace its list without applying deltas itself.

use std::collections::BTreeMap;
use std::fmt::Debug;
use std::hash::Hash;
use std::sync::Arc;

use futures::StreamExt;
use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::{Event as CoreEvent, Pod, Service};
use kube::runtime::watcher::{Config, Event};
use kube::Api;
use serde::de::DeserializeOwned;

use crate::client_cache::ClientCache;
use crate::deployments::{summarise as summarise_deployment, DeploymentSummary};
use crate::events::{summarise as summarise_event, EventSummary};
use crate::services::{summarise as summarise_service, ServiceSummary};
use crate::workloads::{summarise_pod, PodSummary};

/// Normalised watch event over summaries (decoupled from kube-rs types so the
/// reducer is unit-testable).
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum WatchEvent<T> {
    Init,
    InitApply(T),
    InitDone,
    Apply(T),
    Delete(String),
}

/// Apply an event to the map. Returns `true` when a snapshot should be emitted.
pub(crate) fn reduce<T>(
    state: &mut BTreeMap<String, T>,
    key_of: &impl Fn(&T) -> String,
    event: WatchEvent<T>,
) -> bool {
    match event {
        WatchEvent::Init => {
            state.clear();
            false
        }
        WatchEvent::InitApply(item) => {
            state.insert(key_of(&item), item);
            false
        }
        WatchEvent::InitDone => true,
        WatchEvent::Apply(item) => {
            state.insert(key_of(&item), item);
            true
        }
        WatchEvent::Delete(key) => {
            state.remove(&key);
            true
        }
    }
}

/// Current snapshot as a name-sorted vector.
pub fn snapshot<T: Clone>(state: &BTreeMap<String, T>) -> Vec<T> {
    state.values().cloned().collect()
}

/// Connection health of a watch, surfaced to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchStatus {
    Live,
    Reconnecting,
}

impl WatchStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            WatchStatus::Live => "live",
            WatchStatus::Reconnecting => "reconnecting",
        }
    }
}

/// Generic watch loop: stream `K`, summarise to `T`, key by `key_of`, call
/// `on_update` with a full snapshot on every change, and `on_status` on
/// connection transitions.
///
/// kube-rs `watcher()` is a self-healing infinite stream — on API errors it
/// yields an `Err` item but keeps running and re-lists on the next poll. So we
/// consume with `next()` (not `try_next()?`) and, instead of terminating on the
/// first error, surface `Reconnecting` and carry on until it recovers.
async fn watch_typed<K, T, S, N, F, G>(
    api: Api<K>,
    summarise: S,
    key_of: N,
    mut on_update: F,
    mut on_status: G,
) -> Result<(), String>
where
    K: kube::Resource + Clone + DeserializeOwned + Debug + Send + 'static,
    K::DynamicType: Default + Eq + Hash + Clone + Debug + Unpin,
    T: Clone,
    S: Fn(K) -> T,
    N: Fn(&T) -> String,
    F: FnMut(Vec<T>),
    G: FnMut(WatchStatus),
{
    let mut state: BTreeMap<String, T> = BTreeMap::new();
    let mut stream = kube::runtime::watcher(api, Config::default()).boxed();
    let mut reconnecting = false;
    while let Some(item) = stream.next().await {
        match item {
            Ok(event) => {
                if reconnecting {
                    reconnecting = false;
                    on_status(WatchStatus::Live);
                }
                let mapped = match event {
                    Event::Init => WatchEvent::Init,
                    Event::InitApply(obj) => WatchEvent::InitApply(summarise(obj)),
                    Event::InitDone => WatchEvent::InitDone,
                    Event::Apply(obj) => WatchEvent::Apply(summarise(obj)),
                    Event::Delete(obj) => WatchEvent::Delete(key_of(&summarise(obj))),
                };
                if reduce(&mut state, &key_of, mapped) {
                    on_update(snapshot(&state));
                }
            }
            Err(_) => {
                // Transient: the watcher backs off and re-lists internally. Flag
                // the UI once per outage, then keep consuming.
                if !reconnecting {
                    reconnecting = true;
                    on_status(WatchStatus::Reconnecting);
                }
            }
        }
    }
    Ok(())
}

/// Watch pods in a namespace.
pub async fn watch_pods<F, G>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    on_update: F,
    on_status: G,
) -> Result<(), String>
where
    F: FnMut(Vec<PodSummary>) + Send,
    G: FnMut(WatchStatus) + Send,
{
    let client = cache.get(&context).await?;
    let api: Api<Pod> = crate::scoped_api(client, &namespace);
    watch_typed(api, summarise_pod, |p: &PodSummary| p.name.clone(), on_update, on_status).await
}

/// Watch deployments in a namespace.
pub async fn watch_deployments<F, G>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    on_update: F,
    on_status: G,
) -> Result<(), String>
where
    F: FnMut(Vec<DeploymentSummary>) + Send,
    G: FnMut(WatchStatus) + Send,
{
    let client = cache.get(&context).await?;
    let api: Api<Deployment> = crate::scoped_api(client, &namespace);
    watch_typed(
        api,
        summarise_deployment,
        |d: &DeploymentSummary| d.name.clone(),
        on_update,
        on_status,
    )
    .await
}

/// Watch services in a namespace.
pub async fn watch_services<F, G>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    on_update: F,
    on_status: G,
) -> Result<(), String>
where
    F: FnMut(Vec<ServiceSummary>) + Send,
    G: FnMut(WatchStatus) + Send,
{
    let client = cache.get(&context).await?;
    let api: Api<Service> = crate::scoped_api(client, &namespace);
    watch_typed(
        api,
        summarise_service,
        |s: &ServiceSummary| s.name.clone(),
        on_update,
        on_status,
    )
    .await
}

/// Watch events in a namespace — a true stream, replacing the poll.
pub async fn watch_events<F, G>(
    cache: Arc<ClientCache>,
    context: String,
    namespace: String,
    on_update: F,
    on_status: G,
) -> Result<(), String>
where
    F: FnMut(Vec<EventSummary>) + Send,
    G: FnMut(WatchStatus) + Send,
{
    let client = cache.get(&context).await?;
    let api: Api<CoreEvent> = crate::scoped_api(client, &namespace);
    watch_typed(
        api,
        summarise_event,
        |e: &EventSummary| e.name.clone(),
        on_update,
        on_status,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pod(name: &str, phase: &str) -> PodSummary {
        PodSummary {
            name: name.into(),
            namespace: "default".into(),
            phase: phase.into(),
            ready: "1/1".into(),
            restarts: 0,
            node: "n".into(),
            age: "1m".into(),
        }
    }

    fn key(p: &PodSummary) -> String {
        p.name.clone()
    }

    #[test]
    fn init_sequence_emits_only_on_init_done() {
        let mut state = BTreeMap::new();
        assert!(!reduce(&mut state, &key, WatchEvent::Init));
        assert!(!reduce(&mut state, &key, WatchEvent::InitApply(pod("a", "Running"))));
        assert!(!reduce(&mut state, &key, WatchEvent::InitApply(pod("b", "Pending"))));
        assert!(reduce(&mut state, &key, WatchEvent::InitDone));
        let snap = snapshot(&state);
        assert_eq!(snap.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
    }

    #[test]
    fn apply_upserts_and_emits() {
        let mut state = BTreeMap::new();
        reduce(&mut state, &key, WatchEvent::InitApply(pod("a", "Pending")));
        reduce(&mut state, &key, WatchEvent::InitDone);
        assert!(reduce(&mut state, &key, WatchEvent::Apply(pod("a", "Running"))));
        assert_eq!(snapshot(&state)[0].phase, "Running");
    }

    #[test]
    fn delete_removes_and_emits() {
        let mut state = BTreeMap::new();
        reduce(&mut state, &key, WatchEvent::Apply(pod("a", "Running")));
        reduce(&mut state, &key, WatchEvent::Apply(pod("b", "Running")));
        assert!(reduce(&mut state, &key, WatchEvent::Delete("a".into())));
        let snap = snapshot(&state);
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].name, "b");
    }
}
