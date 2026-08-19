//! Custom Resource Definition discovery + dynamic listing, so the UI can browse
//! any installed CRD (Gateway API, cert-manager, …) without a static GVK table.

use std::sync::Arc;

use srelens_capability::{Annotations, Capability, CapabilityError};
use kube::api::{Api, DynamicObject, ListParams};
use kube::core::{ApiResource, GroupVersionKind};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::client_cache::ClientCache;
use crate::connect::request_timeout;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListCrdsIn {
    pub context: String,
}

/// One column a CRD asks tools to display, from
/// `spec.versions[].additionalPrinterColumns` -- the same metadata `kubectl get`
/// renders. Without these a custom resource list can only show name/namespace/age,
/// because nothing else is common to every kind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PrinterColumn {
    /// Column heading, e.g. "Health".
    pub name: String,
    /// Restricted JSONPath into the resource, e.g. ".status.health".
    pub json_path: String,
    /// OpenAPI type: string, integer, number, boolean or date.
    #[serde(rename = "type", default)]
    pub column_type: String,
}

/// A discovered CustomResourceDefinition, enough to list its instances.
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CrdDescriptor {
    /// Metadata name, e.g. "gateways.gateway.networking.k8s.io".
    pub name: String,
    pub group: String,
    pub version: String,
    pub kind: String,
    pub plural: String,
    pub namespaced: bool,
    /// Columns this CRD asks to have displayed, in declaration order.
    pub printer_columns: Vec<PrinterColumn>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListCrdsOut {
    pub crds: Vec<CrdDescriptor>,
}

fn handler_err(e: impl ToString) -> CapabilityError {
    CapabilityError::Handler(e.to_string())
}

/// The storage version, else the first served version, else the first.
fn chosen_version(spec: &serde_json::Value) -> Option<&serde_json::Value> {
    let versions = spec["versions"].as_array()?;
    versions
        .iter()
        .find(|v| v["storage"].as_bool().unwrap_or(false))
        .or_else(|| versions.iter().find(|v| v["served"].as_bool().unwrap_or(false)))
        .or_else(|| versions.first())
}

/// Choose the storage version, else the first served version, else the first.
fn pick_version(spec: &serde_json::Value) -> String {
    chosen_version(spec)
        .and_then(|v| v["name"].as_str())
        .unwrap_or_default()
        .to_string()
}

/// The printer columns worth showing for the chosen version.
///
/// Drops two kinds that would only add noise: `priority > 0` is `kubectl -o
/// wide` territory, and a column reading `.metadata.creationTimestamp` merely
/// duplicates the Age column every list already renders.
fn printer_columns(spec: &serde_json::Value) -> Vec<PrinterColumn> {
    let Some(version) = chosen_version(spec) else {
        return Vec::new();
    };
    let Some(columns) = version["additionalPrinterColumns"].as_array() else {
        return Vec::new();
    };
    columns
        .iter()
        .filter(|c| c["priority"].as_i64().unwrap_or(0) == 0)
        .filter_map(|c| {
            let json_path = c["jsonPath"].as_str()?.to_string();
            if json_path == ".metadata.creationTimestamp" {
                return None;
            }
            Some(PrinterColumn {
                name: c["name"].as_str()?.to_string(),
                json_path,
                column_type: c["type"].as_str().unwrap_or_default().to_string(),
            })
        })
        .collect()
}

/// Read a CRD `jsonPath` out of a resource, rendering the leaf as display text.
///
/// CRDs use a small JSONPath subset rather than the full grammar, so this walks
/// it directly instead of pulling in an engine. Supported segments:
///
/// - `.foo`, `.a\.b` and `['foo']` / `["foo"]` — object keys; both the escape
///   and the bracket form let a key contain dots, as label keys do
/// - `[0]` — array index
/// - `[?(@.type=="Ready")]` — first array element whose field equals a literal,
///   which is how Flux, cert-manager and most operators surface a condition
///
/// Anything absent, null, or not a scalar renders empty — an empty cell reads
/// better than a blob of JSON.
fn resolve_json_path(value: &serde_json::Value, path: &str) -> String {
    let mut current = value;
    let mut rest = path.trim_start_matches('.');
    while !rest.is_empty() {
        let (segment, remainder) = match rest.strip_prefix('[') {
            Some(open) => {
                let Some(close) = open.find(']') else { return String::new() };
                (Segment::bracket(&open[..close]), open[close + 1..].trim_start_matches('.'))
            }
            None => {
                // Scan to the next *unescaped* separator. `\.` keeps a literal dot
                // inside the key, which is how a CRD can address a label such as
                // `app\.kubernetes\.io/name` without bracket notation.
                let mut key = String::new();
                let mut end = rest.len();
                let mut chars = rest.char_indices();
                while let Some((index, ch)) = chars.next() {
                    match ch {
                        '\\' => {
                            if let Some((_, escaped)) = chars.next() {
                                key.push(escaped);
                            }
                        }
                        '.' | '[' => {
                            end = index;
                            break;
                        }
                        _ => key.push(ch),
                    }
                }
                (Segment::Key(key), rest[end..].trim_start_matches('.'))
            }
        };
        let Some(next) = segment.apply(current) else { return String::new() };
        current = next;
        rest = remainder;
    }
    match current {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// One step of a CRD jsonPath.
enum Segment {
    Key(String),
    Index(usize),
    /// `[?(@.field=="literal")]` — the first array element that matches.
    Filter { field: String, literal: String },
}

impl Segment {
    /// Parse the inside of a `[...]`.
    fn bracket(inner: &str) -> Segment {
        let trimmed = inner.trim();
        if let Some(expression) = trimmed.strip_prefix("?(").and_then(|e| e.strip_suffix(')')) {
            if let Some((left, right)) = expression.split_once("==") {
                return Segment::Filter {
                    field: left.trim().trim_start_matches('@').trim_start_matches('.').to_string(),
                    literal: unquote(right.trim()).to_string(),
                };
            }
        }
        if let Ok(index) = trimmed.parse::<usize>() {
            return Segment::Index(index);
        }
        Segment::Key(unquote(trimmed).to_string())
    }

    fn apply<'v>(&self, value: &'v serde_json::Value) -> Option<&'v serde_json::Value> {
        match self {
            Segment::Key(key) => value.get(key),
            Segment::Index(index) => value.get(index),
            Segment::Filter { field, literal } => value
                .as_array()?
                .iter()
                .find(|item| resolve_json_path(item, field) == *literal),
        }
    }
}

fn unquote(text: &str) -> &str {
    text.trim_matches(|c| c == '\'' || c == '"')
}

/// Put a DynamicObject back together as one JSON value. `kube` splits typed
/// metadata out of `data`, but printer columns address the whole resource, so
/// `.metadata.labels[...]` has to resolve like any other path.
fn whole_object(object: &DynamicObject) -> serde_json::Value {
    let mut value = object.data.clone();
    if let (Some(map), Ok(metadata)) = (value.as_object_mut(), serde_json::to_value(&object.metadata))
    {
        map.insert("metadata".to_string(), metadata);
    }
    value
}

/// Render one cell, humanizing `type: date` columns the way ages are shown
/// elsewhere so a raw RFC 3339 timestamp never reaches the table.
fn render_column(object: &serde_json::Value, column: &PrinterColumn) -> String {
    let raw = resolve_json_path(object, &column.json_path);
    if column.column_type != "date" || raw.is_empty() {
        return raw;
    }
    match raw.parse::<k8s_openapi::jiff::Timestamp>() {
        Ok(ts) => crate::humanize_age(Some(&k8s_openapi::apimachinery::pkg::apis::meta::v1::Time(ts))),
        Err(_) => raw,
    }
}

/// `k8s.listCRDs` — discover installed CustomResourceDefinitions.
pub fn list_crds_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListCrdsIn, ListCrdsOut, _, _>(
        "k8s.listCRDs",
        "list installed CustomResourceDefinitions (group, kind, plural, scope)",
        Annotations::READ_ONLY,
        move |input: ListCrdsIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let gvk =
                    GroupVersionKind::gvk("apiextensions.k8s.io", "v1", "CustomResourceDefinition");
                let ar = ApiResource::from_gvk(&gvk);
                let api: Api<DynamicObject> = Api::all_with(client, &ar);
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list CRDs timed out".into()))?
                    .map_err(handler_err)?;

                let mut crds: Vec<CrdDescriptor> = list
                    .items
                    .into_iter()
                    .filter_map(|o| {
                        let spec = &o.data["spec"];
                        let group = spec["group"].as_str().unwrap_or_default().to_string();
                        let kind = spec["names"]["kind"].as_str().unwrap_or_default().to_string();
                        let plural = spec["names"]["plural"].as_str().unwrap_or_default().to_string();
                        let namespaced = spec["scope"].as_str().unwrap_or("Namespaced") == "Namespaced";
                        let version = pick_version(spec);
                        if group.is_empty() || kind.is_empty() || plural.is_empty() || version.is_empty()
                        {
                            return None;
                        }
                        Some(CrdDescriptor {
                            name: o.metadata.name.unwrap_or_default(),
                            group,
                            version,
                            kind,
                            plural,
                            namespaced,
                            printer_columns: printer_columns(spec),
                        })
                    })
                    .collect();
                crds.sort_by(|a, b| (&a.group, &a.kind).cmp(&(&b.group, &b.kind)));
                Ok(ListCrdsOut { crds })
            }
        },
    )
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListCustomIn {
    pub context: String,
    pub group: String,
    pub version: String,
    pub plural: String,
    pub kind: String,
    pub namespaced: bool,
    #[serde(default)]
    pub namespace: String,
    /// Columns to resolve per item, from the CRD's `additionalPrinterColumns`.
    /// Callers that omit these get just name/namespace/age, as before.
    #[serde(default)]
    pub printer_columns: Vec<PrinterColumn>,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomRow {
    pub name: String,
    pub namespace: String,
    pub age: String,
    /// Values for the requested printer columns, in the order they were asked
    /// for. Empty when none were requested.
    pub columns: Vec<String>,
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct ListCustomOut {
    pub items: Vec<CustomRow>,
}

/// Build a dynamic ApiResource for an arbitrary CRD GVK + plural.
pub(crate) fn custom_api_resource(group: &str, version: &str, kind: &str, plural: &str) -> ApiResource {
    let api_version = if group.is_empty() {
        version.to_string()
    } else {
        format!("{group}/{version}")
    };
    ApiResource {
        group: group.to_string(),
        version: version.to_string(),
        api_version,
        kind: kind.to_string(),
        plural: plural.to_string(),
    }
}

/// `k8s.listCustomResource` — list instances of a CRD by its GVK + plural.
pub fn list_custom_resource_capability(cache: Arc<ClientCache>) -> Capability {
    Capability::typed::<ListCustomIn, ListCustomOut, _, _>(
        "k8s.listCustomResource",
        "list instances of a custom resource by group/version/plural",
        Annotations::READ_ONLY,
        move |input: ListCustomIn| {
            let cache = cache.clone();
            async move {
                let client = cache.get(&input.context).await.map_err(CapabilityError::Handler)?;
                let ar = custom_api_resource(&input.group, &input.version, &input.kind, &input.plural);
                let api: Api<DynamicObject> = if input.namespaced && !input.namespace.is_empty() {
                    Api::namespaced_with(client, &input.namespace, &ar)
                } else {
                    Api::all_with(client, &ar)
                };
                let list = tokio::time::timeout(request_timeout(), api.list(&ListParams::default()))
                    .await
                    .map_err(|_| CapabilityError::Handler("list custom resource timed out".into()))?
                    .map_err(handler_err)?;
                let columns = input.printer_columns;
                let items = list
                    .items
                    .into_iter()
                    .map(|o| {
                        let values = if columns.is_empty() {
                            Vec::new()
                        } else {
                            let object = whole_object(&o);
                            columns.iter().map(|c| render_column(&object, c)).collect()
                        };
                        CustomRow {
                            name: o.metadata.name.clone().unwrap_or_default(),
                            namespace: o.metadata.namespace.clone().unwrap_or_default(),
                            age: crate::humanize_age(o.metadata.creation_timestamp.as_ref()),
                            columns: values,
                        }
                    })
                    .collect();
                Ok(ListCustomOut { items })
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn capabilities_have_ids() {
        let cache = ClientCache::new(PathBuf::from("/x"));
        assert_eq!(list_crds_capability(cache.clone()).id, "k8s.listCRDs");
        assert_eq!(list_custom_resource_capability(cache).id, "k8s.listCustomResource");
    }

    #[test]
    fn picks_storage_version() {
        let spec = serde_json::json!({
            "versions": [
                {"name": "v1alpha1", "served": true, "storage": false},
                {"name": "v1beta1", "served": true, "storage": true},
            ]
        });
        assert_eq!(pick_version(&spec), "v1beta1");
    }

    fn obj() -> serde_json::Value {
        serde_json::json!({
            "spec": { "version": "4.1.2", "nodes": 3, "paused": false },
            "status": { "health": "GREEN", "conditions": [{"type": "Ready"}], "empty": null },
            "metadata": { "labels": { "app.kubernetes.io/name": "cassandra" } },
        })
    }

    #[test]
    fn resolves_dotted_paths_to_scalars() {
        assert_eq!(resolve_json_path(&obj(), ".status.health"), "GREEN");
        assert_eq!(resolve_json_path(&obj(), ".spec.version"), "4.1.2");
        // Numbers and bools render as text, not JSON-quoted.
        assert_eq!(resolve_json_path(&obj(), ".spec.nodes"), "3");
        assert_eq!(resolve_json_path(&obj(), ".spec.paused"), "false");
    }

    #[test]
    fn resolves_backslash_escaped_dots_in_key_names() {
        // A CRD may address a dotted label key without bracket notation.
        assert_eq!(
            resolve_json_path(&obj(), r".metadata.labels.app\.kubernetes\.io/name"),
            "cassandra"
        );
    }

    #[test]
    fn resolves_bracket_segments_for_keys_containing_dots() {
        assert_eq!(
            resolve_json_path(&obj(), ".metadata.labels['app.kubernetes.io/name']"),
            "cassandra"
        );
    }

    /// Flux's HelmRelease, cert-manager and many operators address a condition
    /// by type rather than by index, so the filter form is not exotic.
    fn fluxish() -> serde_json::Value {
        serde_json::json!({
            "status": { "conditions": [
                {"type": "Stalled", "status": "False", "message": "nope"},
                {"type": "Ready", "status": "True", "message": "Release reconciliation succeeded"},
            ]},
            "spec": { "ports": [{"port": 80}, {"port": 443}] },
        })
    }

    #[test]
    fn resolves_filter_expressions_by_field_equality() {
        assert_eq!(
            resolve_json_path(&fluxish(), ".status.conditions[?(@.type==\"Ready\")].status"),
            "True"
        );
        assert_eq!(
            resolve_json_path(&fluxish(), ".status.conditions[?(@.type==\"Ready\")].message"),
            "Release reconciliation succeeded"
        );
    }

    #[test]
    fn filter_expressions_accept_single_quotes_and_spacing() {
        assert_eq!(
            resolve_json_path(&fluxish(), ".status.conditions[?(@.type == 'Stalled')].status"),
            "False"
        );
    }

    #[test]
    fn a_filter_matching_nothing_renders_empty() {
        assert_eq!(
            resolve_json_path(&fluxish(), ".status.conditions[?(@.type==\"Missing\")].status"),
            ""
        );
    }

    #[test]
    fn resolves_numeric_array_indexes() {
        assert_eq!(resolve_json_path(&fluxish(), ".spec.ports[1].port"), "443");
        assert_eq!(resolve_json_path(&fluxish(), ".spec.ports[9].port"), "");
    }

    #[test]
    fn missing_null_and_non_scalar_paths_render_empty() {
        assert_eq!(resolve_json_path(&obj(), ".status.nope"), "");
        assert_eq!(resolve_json_path(&obj(), ".status.empty"), "");
        // kubectl renders arrays/objects poorly; an empty cell beats noise.
        assert_eq!(resolve_json_path(&obj(), ".status.conditions"), "");
        assert_eq!(resolve_json_path(&obj(), ".spec"), "");
    }

    fn spec_with_columns() -> serde_json::Value {
        serde_json::json!({
            "versions": [{
                "name": "v1", "served": true, "storage": true,
                "additionalPrinterColumns": [
                    {"name": "Health", "type": "string", "jsonPath": ".status.health"},
                    {"name": "Version", "type": "string", "jsonPath": ".spec.version"},
                    {"name": "Verbose", "type": "string", "jsonPath": ".spec.x", "priority": 1},
                    {"name": "Age", "type": "date", "jsonPath": ".metadata.creationTimestamp"},
                ],
            }]
        })
    }

    #[test]
    fn takes_printer_columns_from_the_chosen_version() {
        let cols = printer_columns(&spec_with_columns());
        // Priority > 0 is `kubectl -o wide` only, and the table already has its
        // own Age column, so neither should reach the UI.
        assert_eq!(
            cols.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["Health", "Version"]
        );
        assert_eq!(cols[0].json_path, ".status.health");
    }

    #[test]
    fn a_crd_without_printer_columns_yields_none() {
        let spec = serde_json::json!({"versions": [{"name": "v1", "storage": true}]});
        assert!(printer_columns(&spec).is_empty());
    }

    #[test]
    fn date_columns_render_as_an_age_not_a_timestamp() {
        let object = serde_json::json!({"status": {"since": "2020-01-01T00:00:00Z"}});
        let column = PrinterColumn {
            name: "Since".into(),
            json_path: ".status.since".into(),
            column_type: "date".into(),
        };
        let rendered = render_column(&object, &column);
        // Compact age (e.g. "6y"), never the raw RFC 3339 string.
        assert!(!rendered.contains("2020-01-01"), "got {rendered}");
        assert!(rendered.ends_with('y'), "got {rendered}");
    }

    #[test]
    fn unparseable_date_falls_back_to_the_raw_value() {
        let object = serde_json::json!({"status": {"since": "not a date"}});
        let column = PrinterColumn {
            name: "Since".into(),
            json_path: ".status.since".into(),
            column_type: "date".into(),
        };
        assert_eq!(render_column(&object, &column), "not a date");
    }

    #[test]
    fn metadata_paths_resolve_even_though_kube_splits_metadata_out() {
        let object: DynamicObject = serde_json::from_value(serde_json::json!({
            "apiVersion": "db.example.com/v1",
            "kind": "Cluster",
            "metadata": {"name": "c1", "labels": {"app.kubernetes.io/name": "cassandra"}},
            "spec": {"version": "4.1.2"},
        }))
        .expect("dynamic object");
        let whole = whole_object(&object);
        assert_eq!(
            resolve_json_path(&whole, ".metadata.labels['app.kubernetes.io/name']"),
            "cassandra"
        );
        assert_eq!(resolve_json_path(&whole, ".spec.version"), "4.1.2");
    }

    /// End-to-end over Flux's HelmRelease, which is where the empty Ready and
    /// Status cells were first seen: its columns are filter expressions, and it
    /// declares its own Age that would otherwise duplicate the built-in one.
    #[test]
    fn renders_flux_helmrelease_columns() {
        let spec = serde_json::json!({
            "versions": [{
                "name": "v2", "served": true, "storage": true,
                "additionalPrinterColumns": [
                    {"name": "Age", "type": "date", "jsonPath": ".metadata.creationTimestamp"},
                    {"name": "Ready", "type": "string",
                     "jsonPath": ".status.conditions[?(@.type==\"Ready\")].status"},
                    {"name": "Status", "type": "string",
                     "jsonPath": ".status.conditions[?(@.type==\"Ready\")].message"},
                ],
            }]
        });
        let columns = printer_columns(&spec);
        assert_eq!(
            columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["Ready", "Status"],
        );

        let release = serde_json::json!({
            "status": {"conditions": [
                {"type": "Released", "status": "True", "message": "Helm install succeeded"},
                {"type": "Ready", "status": "True", "message": "Release reconciliation succeeded"},
            ]}
        });
        let rendered: Vec<String> =
            columns.iter().map(|c| render_column(&release, c)).collect();
        assert_eq!(rendered, vec!["True", "Release reconciliation succeeded"]);
    }

    #[test]
    fn builds_namespaced_api_version() {
        let ar = custom_api_resource("gateway.networking.k8s.io", "v1", "Gateway", "gateways");
        assert_eq!(ar.api_version, "gateway.networking.k8s.io/v1");
        assert_eq!(ar.plural, "gateways");
    }
}
