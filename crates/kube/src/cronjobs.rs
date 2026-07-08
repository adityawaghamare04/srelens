//! The `k8s.listCronJobs` capability.

use std::sync::Arc;

use srelens_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::batch::v1::CronJob;
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListCronJobsIn {
    pub context: String,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct CronJobSummary {
    pub name: String,
    pub namespace: String,
    pub schedule: String,
    pub suspended: bool,
    pub active: i32,
    /// Humanized age of the last scheduled run, or "" if never scheduled.
    #[serde(rename = "lastSchedule")]
    pub last_schedule: String,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListCronJobsOut {
    pub cronjobs: Vec<CronJobSummary>,
}

pub(crate) fn summarise(cj: CronJob) -> CronJobSummary {
    let spec = cj.spec.as_ref();
    let status = cj.status.as_ref();
    let last_schedule = status
        .and_then(|s| s.last_schedule_time.as_ref())
        .map(|t| crate::humanize_age(Some(t)))
        .unwrap_or_default();
    CronJobSummary {
        name: cj.metadata.name.clone().unwrap_or_default(),
        namespace: cj.metadata.namespace.clone().unwrap_or_default(),
        schedule: spec.map(|s| s.schedule.clone()).unwrap_or_default(),
        suspended: spec.and_then(|s| s.suspend).unwrap_or(false),
        active: status.map(|s| s.active.as_ref().map_or(0, |a| a.len() as i32)).unwrap_or(0),
        last_schedule,
        age: crate::humanize_age(cj.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listCronJobs` — list CronJobs in a namespace.
pub fn list_cronjobs_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListCronJobsIn, ListCronJobsOut, _, _>(
        "k8s.listCronJobs",
        "list CronJobs in a namespace of a connected kube context",
        Annotations::READ_ONLY,
        move |input: ListCronJobsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<CronJob> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list cronjobs timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(ListCronJobsOut {
                    cronjobs: list.items.into_iter().map(summarise).collect(),
                })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::batch::v1::{CronJobSpec, CronJobStatus};
    use k8s_openapi::apimachinery::pkg::apis::meta::v1::Time;
    use k8s_openapi::chrono::Utc;
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id() {
        let cap = list_cronjobs_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listCronJobs");
        assert!(cap.annotations.read_only);
    }

    #[test]
    fn summarises_schedule_suspend_and_active() {
        let cj = CronJob {
            metadata: kube::core::ObjectMeta {
                name: Some("nightly".into()),
                namespace: Some("ops".into()),
                ..Default::default()
            },
            spec: Some(CronJobSpec {
                schedule: "0 2 * * *".into(),
                suspend: Some(true),
                ..Default::default()
            }),
            status: Some(CronJobStatus {
                active: Some(vec![Default::default(), Default::default()]),
                last_schedule_time: Some(Time(Utc::now())),
                ..Default::default()
            }),
        };
        let s = summarise(cj);
        assert_eq!(s.name, "nightly");
        assert_eq!(s.namespace, "ops");
        assert_eq!(s.schedule, "0 2 * * *");
        assert!(s.suspended);
        assert_eq!(s.active, 2);
        assert_eq!(s.last_schedule, "0s");
    }

    #[test]
    fn never_scheduled_cronjob_defaults() {
        let cj = CronJob {
            metadata: kube::core::ObjectMeta {
                name: Some("weekly".into()),
                ..Default::default()
            },
            spec: Some(CronJobSpec {
                schedule: "0 0 * * 0".into(),
                ..Default::default()
            }),
            status: Some(CronJobStatus::default()),
        };
        let s = summarise(cj);
        assert!(!s.suspended);
        assert_eq!(s.active, 0);
        assert_eq!(s.last_schedule, "");
    }
}
