//! The `k8s.listSecrets` capability.
//!
//! The summary deliberately carries only the Secret's **type** and **key
//! count** — never any key names or values — so listing Secrets can never leak
//! material. Values are only ever fetched (and masked) in the detail view.

use std::sync::Arc;

use srelens_capability::{Annotations, Capability, CapabilityError};
use k8s_openapi::api::core::v1::Secret;
use kube::api::ListParams;
use kube::Api;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListSecretsIn {
    pub context: String,
    pub namespace: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
pub struct SecretSummary {
    pub name: String,
    pub namespace: String,
    /// The Secret's `type` (e.g. `Opaque`, `kubernetes.io/tls`).
    #[serde(rename = "type")]
    pub type_: String,
    /// Number of keys — NOT their names or values.
    pub keys: i32,
    pub age: String,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListSecretsOut {
    pub secrets: Vec<SecretSummary>,
}

pub(crate) fn summarise(secret: Secret) -> SecretSummary {
    let keys = secret.data.as_ref().map_or(0, |d| d.len())
        + secret.string_data.as_ref().map_or(0, |d| d.len());
    SecretSummary {
        name: secret.metadata.name.clone().unwrap_or_default(),
        namespace: secret.metadata.namespace.clone().unwrap_or_default(),
        type_: secret.type_.clone().unwrap_or_default(),
        keys: keys as i32,
        age: crate::humanize_age(secret.metadata.creation_timestamp.as_ref()),
    }
}

/// `k8s.listSecrets` — list Secrets in a namespace (type + key count only).
pub fn list_secrets_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListSecretsIn, ListSecretsOut, _, _>(
        "k8s.listSecrets",
        "list Secrets in a namespace (name, type, and key count only — no values)",
        Annotations::READ_ONLY,
        move |input: ListSecretsIn| {
            let cache = cache.clone();
            async move {
                let client = cache
                    .get(&input.context)
                    .await
                    .map_err(CapabilityError::Handler)?;
                let api: Api<Secret> = crate::scoped_api(client, &input.namespace);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list secrets timed out".into()))?
                    .map_err(|e| CapabilityError::Handler(e.to_string()))?;
                Ok(ListSecretsOut {
                    secrets: list.items.into_iter().map(summarise).collect(),
                })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    #[test]
    fn capability_has_expected_id() {
        let cap = list_secrets_capability(ClientCache::new(PathBuf::from("/x")));
        assert_eq!(cap.id, "k8s.listSecrets");
        assert!(cap.annotations.read_only);
    }

    #[test]
    fn summarises_type_and_key_count_without_values() {
        let mut data = BTreeMap::new();
        data.insert("tls.crt".to_string(), k8s_openapi::ByteString(b"SECRET-CERT".to_vec()));
        data.insert("tls.key".to_string(), k8s_openapi::ByteString(b"SECRET-KEY".to_vec()));
        let secret = Secret {
            metadata: kube::core::ObjectMeta {
                name: Some("web-tls".into()),
                namespace: Some("default".into()),
                ..Default::default()
            },
            type_: Some("kubernetes.io/tls".into()),
            data: Some(data),
            ..Default::default()
        };
        let s = summarise(secret);
        assert_eq!(s.name, "web-tls");
        assert_eq!(s.type_, "kubernetes.io/tls");
        assert_eq!(s.keys, 2);
        // The summary carries no field that could hold key material.
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("SECRET"), "summary must not contain any secret material: {json}");
        assert!(!json.contains("tls.crt"), "summary must not contain key names: {json}");
    }
}
