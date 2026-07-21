//! `k8s.canI` — batched preflight authorization checks via SelfSubjectAccessReview.
//!
//! Each check becomes one SSAR (`authorization.k8s.io/v1`) run concurrently. The
//! result is a UI hint only: it can disable a control the user can't use, but the
//! API server remains the source of truth (an unknown result never claims access).

use std::sync::Arc;

use futures::future::join_all;
use k8s_openapi::api::authorization::v1::{
    ResourceAttributes, SelfSubjectAccessReview, SelfSubjectAccessReviewSpec,
    SubjectAccessReviewStatus,
};
use kube::api::{Api, PostParams};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use srelens_capability::{Annotations, Capability, CapabilityError};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(default)]
pub struct AccessCheck {
    pub verb: String,
    pub group: String,
    pub resource: String,
    pub subresource: String,
    pub namespace: String,
    pub name: String,
}

impl Default for AccessCheck {
    fn default() -> Self {
        Self {
            verb: String::new(),
            group: String::new(),
            resource: String::new(),
            subresource: String::new(),
            namespace: String::new(),
            name: String::new(),
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CanIIn {
    pub context: String,
    pub checks: Vec<AccessCheck>,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct AccessResult {
    pub allowed: bool,
    pub denied: bool,
    pub reason: String,
    /// The check FAILED (network error / timeout) rather than completing. A
    /// completed review with `allowed:false` is a real denial; `error:true`
    /// means the frontend should retry, not cache a permanent "no permission".
    pub error: bool,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct CanIOut {
    pub results: Vec<AccessResult>,
}

/// Build a SelfSubjectAccessReview for one check (pure — no I/O).
fn build_review(check: &AccessCheck) -> SelfSubjectAccessReview {
    let opt = |s: &str| {
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    };
    SelfSubjectAccessReview {
        spec: SelfSubjectAccessReviewSpec {
            resource_attributes: Some(ResourceAttributes {
                verb: opt(&check.verb),
                group: opt(&check.group),
                resource: opt(&check.resource),
                subresource: opt(&check.subresource),
                namespace: opt(&check.namespace),
                name: opt(&check.name),
                ..Default::default()
            }),
            ..Default::default()
        },
        ..Default::default()
    }
}

/// Map an SSAR status into our result (pure). `None`/unknown never claims access.
fn result_from_status(status: Option<&SubjectAccessReviewStatus>) -> AccessResult {
    match status {
        Some(s) => AccessResult {
            allowed: s.allowed,
            denied: s.denied.unwrap_or(false),
            reason: s.reason.clone().unwrap_or_default(),
            error: false,
        },
        None => AccessResult {
            allowed: false,
            denied: false,
            reason: String::new(),
            error: false,
        },
    }
}

/// `k8s.canI` — batched SelfSubjectAccessReview. Results align 1:1 with `checks`.
pub fn can_i_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<CanIIn, CanIOut, _, _>(
        "k8s.canI",
        "check whether the current user can perform actions (SelfSubjectAccessReview, batched)",
        Annotations::READ_ONLY,
        move |input: CanIIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<SelfSubjectAccessReview> = Api::all(client);
                let futures = input.checks.iter().map(|check| {
                    let api = api.clone();
                    let review = build_review(check);
                    async move {
                        match tokio::time::timeout(
                            request_timeout(),
                            api.create(&PostParams::default(), &review),
                        )
                        .await
                        {
                            Ok(Ok(created)) => result_from_status(created.status.as_ref()),
                            Ok(Err(e)) => AccessResult {
                                allowed: false,
                                denied: false,
                                reason: e.to_string(),
                                error: true,
                            },
                            Err(_) => AccessResult {
                                allowed: false,
                                denied: false,
                                reason: "access check timed out".into(),
                                error: true,
                            },
                        }
                    }
                });
                let results = join_all(futures).await;
                Ok(CanIOut { results })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::authorization::v1::SubjectAccessReviewStatus;
    use std::path::PathBuf;

    #[test]
    fn builds_resource_attributes_from_a_check() {
        let check = AccessCheck {
            verb: "patch".into(),
            group: "apps".into(),
            resource: "deployments".into(),
            subresource: "scale".into(),
            namespace: "prod".into(),
            name: String::new(),
        };
        let review = build_review(&check);
        let attrs = review.spec.resource_attributes.unwrap();
        assert_eq!(attrs.verb.as_deref(), Some("patch"));
        assert_eq!(attrs.group.as_deref(), Some("apps"));
        assert_eq!(attrs.resource.as_deref(), Some("deployments"));
        assert_eq!(attrs.subresource.as_deref(), Some("scale"));
        assert_eq!(attrs.namespace.as_deref(), Some("prod"));
        assert_eq!(attrs.name, None); // empty -> omitted
    }

    #[test]
    fn maps_ssar_status_to_result() {
        let allowed = result_from_status(Some(&SubjectAccessReviewStatus {
            allowed: true,
            denied: None,
            reason: None,
            evaluation_error: None,
        }));
        assert!(allowed.allowed && !allowed.denied);
        // A completed review is authoritative — never an error, even when allowed.
        assert!(!allowed.error);

        let denied = result_from_status(Some(&SubjectAccessReviewStatus {
            allowed: false,
            denied: Some(true),
            reason: Some("RBAC: no rule".into()),
            evaluation_error: None,
        }));
        assert!(!denied.allowed && denied.denied);
        assert_eq!(denied.reason, "RBAC: no rule");
        // A completed denial is authoritative, not a failed check.
        assert!(!denied.error);

        let unknown = result_from_status(None);
        assert!(!unknown.allowed && !unknown.denied);
        assert!(!unknown.error);
    }

    #[test]
    fn capability_is_read_only_with_expected_id() {
        let cap = can_i_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.canI");
        assert!(cap.annotations.read_only);
    }
}
