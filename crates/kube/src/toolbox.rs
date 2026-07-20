//! Toolbox diagnosis engine (pure).
//!
//! The top onboarding failure for exec-auth kubeconfigs is a missing tool:
//! `kubectl oidc-login` fails when `kubectl-oidc_login` isn't installed. This
//! module reads the exec-auth blocks of loaded kubeconfigs and turns each
//! context into the set of external binaries it depends on, classified by
//! whether srelens can install them (kubectl / krew plugins) or only report
//! them (cloud CLIs). Resolution of those requirements against the app's PATH
//! is a separate step; this half is pure string work and fully unit-tested.

use crate::helm_cli::resolve_on_path;
use crate::kubeconfig::KubeError;
use serde::Deserialize;
use std::path::Path;

/// What kind of tool a requirement is — decides whether srelens can fix it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequirementKind {
    /// The `kubectl` binary itself.
    Kubectl,
    /// A kubectl plugin installable via krew. `plugin` is the krew plugin name
    /// (dashes, e.g. `oidc-login`); the binary it installs is in
    /// [`Requirement::binary`] (`kubectl-oidc_login`).
    KrewPlugin { plugin: String },
    /// A tool srelens does not manage (cloud CLI, custom binary): detected and
    /// reported with a vendor link, never installed.
    External,
}

/// One external binary a context's exec-auth depends on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Requirement {
    /// The binary to resolve on PATH (`kubectl`, `kubectl-oidc_login`, `aws`),
    /// or an absolute path when the exec `command` was written as one.
    pub binary: String,
    pub kind: RequirementKind,
}

/// The exec-auth tool requirements of a single kubeconfig context.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextRequirements {
    pub context: String,
    /// Empty when the context's user has no exec block — nothing external is
    /// needed, which is a healthy state, not an error.
    pub requirements: Vec<Requirement>,
}

/// Parse a kubeconfig document into each context's exec-auth requirement set.
/// Contexts are returned in document order; a context whose user has no exec
/// block yields an empty requirement list.
pub fn context_requirements(yaml: &str) -> Result<Vec<ContextRequirements>, KubeError> {
    let raw: Raw = serde_yaml::from_str(yaml).map_err(|e| KubeError::Parse(e.to_string()))?;
    let exec_of = |user: &str| {
        raw.users
            .iter()
            .find(|u| u.name == user)
            .and_then(|u| u.user.exec.as_ref())
    };
    Ok(raw
        .contexts
        .iter()
        .map(|c| ContextRequirements {
            context: c.name.clone(),
            requirements: exec_of(&c.context.user)
                .map(|e| requirements_for_exec(&e.command, &e.args))
                .unwrap_or_default(),
        })
        .collect())
}

/// Turn one exec block (`command` + `args`) into the binaries it needs.
fn requirements_for_exec(command: &str, args: &[String]) -> Vec<Requirement> {
    let (command, args) = strip_env_wrapper(command, args);
    let is_path = command.contains('/');
    let base = command.rsplit('/').next().unwrap_or(command);

    // A path or a non-kubectl binary is a single external tool checked as
    // written; kubectl deployments deliberately name it in full.
    if base != "kubectl" {
        return vec![Requirement {
            binary: if is_path { command.to_string() } else { base.to_string() },
            kind: RequirementKind::External,
        }];
    }

    // `kubectl` (or `/path/to/kubectl`) always needs kubectl itself.
    let mut reqs = vec![Requirement {
        binary: if is_path { command.to_string() } else { "kubectl".to_string() },
        kind: RequirementKind::Kubectl,
    }];
    // The first non-flag argument is the plugin invocation, e.g. `oidc-login`.
    // kubectl resolves `kubectl <plugin>` to the binary `kubectl-<plugin>` with
    // dashes rewritten to underscores; krew installs it under the dashed name.
    if let Some(plugin) = args.iter().find(|a| !a.starts_with('-')) {
        reqs.push(Requirement {
            binary: format!("kubectl-{}", plugin.replace('-', "_")),
            kind: RequirementKind::KrewPlugin { plugin: plugin.clone() },
        });
    }
    reqs
}

/// `command: env, args: [FOO=bar, aws, ...]` is a wrapper — unwrap to the real
/// command and its arguments. Leading `NAME=VALUE` tokens are the injected
/// environment and are skipped.
fn strip_env_wrapper<'a>(command: &'a str, args: &'a [String]) -> (&'a str, &'a [String]) {
    let base = command.rsplit('/').next().unwrap_or(command);
    if base != "env" {
        return (command, args);
    }
    let real = args.iter().position(|a| !a.contains('='));
    match real {
        Some(i) => (args[i].as_str(), &args[i + 1..]),
        None => (command, args),
    }
}

#[derive(Deserialize)]
struct Raw {
    #[serde(default)]
    contexts: Vec<RawContext>,
    #[serde(default)]
    users: Vec<RawUser>,
}
#[derive(Deserialize)]
struct RawContext {
    name: String,
    #[serde(default)]
    context: RawContextData,
}
#[derive(Deserialize, Default)]
struct RawContextData {
    #[serde(default)]
    user: String,
}
#[derive(Deserialize)]
struct RawUser {
    name: String,
    #[serde(default)]
    user: RawUserData,
}
#[derive(Deserialize, Default)]
struct RawUserData {
    #[serde(default)]
    exec: Option<RawExec>,
}
#[derive(Deserialize)]
struct RawExec {
    #[serde(default)]
    command: String,
    #[serde(default)]
    args: Vec<String>,
}

/// The directories the resolver searches, as PATH-style strings (matching the
/// rest of the crate). A hit in `app_path` is usable now; a hit only in
/// `system_path` is present-but-not-visible-to-the-app.
pub struct SearchPaths {
    /// The app's effective PATH (post `fix-path-env`) plus `~/.srelens/bin` and
    /// `~/.krew/bin`.
    pub app_path: String,
    /// Broader locations a tool might live in that the app doesn't search.
    pub system_path: String,
}

/// Whether a requirement is satisfied, and if so from where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Resolution {
    /// On the app's effective PATH (or an absolute exec path that exists) —
    /// usable now. `version` is populated for kubectl.
    Found { path: String, version: Option<String> },
    /// Present on the system but off the app's PATH — needs a PATH fix, not an
    /// install.
    NotOnAppPath { path: String },
    /// Not found anywhere searched.
    Missing,
}

/// A requirement paired with where (if anywhere) it resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedRequirement {
    pub requirement: Requirement,
    pub resolution: Resolution,
}

/// A context's exec-auth requirements, each resolved against the search paths —
/// the single type that drives the health UI, the error deep-link, and the
/// `toolbox.diagnoseContext` capability.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosisReport {
    pub context: String,
    pub items: Vec<ResolvedRequirement>,
}

/// Locate `binary` against the search paths. A bare name is searched in the app
/// path first (usable), then the system path (present-but-hidden). A command
/// written as a path is exec'd directly by client-go, so PATH is irrelevant: it
/// resolves iff the file exists where written.
pub fn locate(
    binary: &str,
    paths: &SearchPaths,
    is_file: &impl Fn(&Path) -> bool,
) -> Option<Located> {
    // A command written as a path is exec'd directly by client-go; PATH is
    // irrelevant, so it's usable iff the file exists exactly where written.
    if binary.contains('/') {
        return is_file(Path::new(binary))
            .then(|| Located { path: binary.to_string(), on_app_path: true });
    }
    if let Some(p) = resolve_on_path(binary, &paths.app_path, is_file) {
        return Some(Located { path: p.to_string_lossy().into_owned(), on_app_path: true });
    }
    resolve_on_path(binary, &paths.system_path, is_file)
        .map(|p| Located { path: p.to_string_lossy().into_owned(), on_app_path: false })
}

/// Where a requirement was found and whether the app can use it as-is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    pub path: String,
    pub on_app_path: bool,
}

/// Resolve every requirement of a context into a [`DiagnosisReport`].
/// `kubectl_version` is injected (it runs a subprocess in production) and is
/// consulted only for a found kubectl binary.
pub fn diagnose(
    ctx: &ContextRequirements,
    paths: &SearchPaths,
    is_file: &impl Fn(&Path) -> bool,
    kubectl_version: &impl Fn(&Path) -> Option<String>,
) -> DiagnosisReport {
    let items = ctx
        .requirements
        .iter()
        .map(|req| {
            let resolution = match locate(&req.binary, paths, is_file) {
                None => Resolution::Missing,
                Some(l) if !l.on_app_path => Resolution::NotOnAppPath { path: l.path },
                Some(l) => {
                    // Only kubectl reports a client version.
                    let version = matches!(req.kind, RequirementKind::Kubectl)
                        .then(|| kubectl_version(Path::new(&l.path)))
                        .flatten();
                    Resolution::Found { path: l.path, version }
                }
            };
            ResolvedRequirement { requirement: req.clone(), resolution }
        })
        .collect();
    DiagnosisReport { context: ctx.context.clone(), items }
}

#[cfg(test)]
mod resolution_tests {
    use super::*;

    /// A fake filesystem: the given paths exist and are executable.
    fn fs(existing: &[&str]) -> impl Fn(&Path) -> bool {
        let owned: Vec<std::path::PathBuf> = existing.iter().map(std::path::PathBuf::from).collect();
        move |p: &Path| owned.iter().any(|e| e == p)
    }

    fn paths() -> SearchPaths {
        SearchPaths { app_path: "/app/bin".into(), system_path: "/usr/bin".into() }
    }

    fn kubectl_req() -> Requirement {
        Requirement { binary: "kubectl".into(), kind: RequirementKind::Kubectl }
    }

    #[test]
    fn a_binary_on_the_app_path_is_found() {
        assert_eq!(
            locate("kubectl", &paths(), &fs(&["/app/bin/kubectl"])),
            Some(Located { path: "/app/bin/kubectl".into(), on_app_path: true }),
        );
    }

    #[test]
    fn a_binary_only_on_the_system_path_is_not_on_app_path() {
        assert_eq!(
            locate("kubectl", &paths(), &fs(&["/usr/bin/kubectl"])),
            Some(Located { path: "/usr/bin/kubectl".into(), on_app_path: false }),
        );
    }

    #[test]
    fn a_binary_found_nowhere_is_none() {
        assert_eq!(locate("kubectl", &paths(), &fs(&[])), None);
    }

    #[test]
    fn an_absolute_command_resolves_at_its_written_path_and_is_usable() {
        let p = "/opt/sdk/gke-gcloud-auth-plugin";
        assert_eq!(
            locate(p, &paths(), &fs(&[p])),
            Some(Located { path: p.into(), on_app_path: true }),
        );
        assert_eq!(locate(p, &paths(), &fs(&[])), None);
    }

    #[test]
    fn diagnose_reports_found_kubectl_with_version_and_missing_plugin_in_order() {
        let ctx = ContextRequirements {
            context: "dev".into(),
            requirements: vec![
                kubectl_req(),
                Requirement {
                    binary: "kubectl-oidc_login".into(),
                    kind: RequirementKind::KrewPlugin { plugin: "oidc-login".into() },
                },
            ],
        };
        let report = diagnose(
            &ctx,
            &paths(),
            &fs(&["/app/bin/kubectl"]),
            &|_p| Some("v1.30.2".into()),
        );
        assert_eq!(
            report,
            DiagnosisReport {
                context: "dev".into(),
                items: vec![
                    ResolvedRequirement {
                        requirement: kubectl_req(),
                        resolution: Resolution::Found {
                            path: "/app/bin/kubectl".into(),
                            version: Some("v1.30.2".into()),
                        },
                    },
                    ResolvedRequirement {
                        requirement: Requirement {
                            binary: "kubectl-oidc_login".into(),
                            kind: RequirementKind::KrewPlugin { plugin: "oidc-login".into() },
                        },
                        resolution: Resolution::Missing,
                    },
                ],
            },
        );
    }

    #[test]
    fn version_is_only_probed_for_kubectl_not_other_found_tools() {
        let ctx = ContextRequirements {
            context: "eks".into(),
            requirements: vec![Requirement {
                binary: "aws".into(),
                kind: RequirementKind::External,
            }],
        };
        // The version probe would panic if called for a non-kubectl tool.
        let report = diagnose(&ctx, &paths(), &fs(&["/app/bin/aws"]), &|_p| {
            panic!("kubectl_version must not be called for external tools")
        });
        assert_eq!(
            report.items[0].resolution,
            Resolution::Found { path: "/app/bin/aws".into(), version: None },
        );
    }

    #[test]
    fn a_tool_off_the_app_path_reports_not_on_app_path() {
        let ctx = ContextRequirements {
            context: "eks".into(),
            requirements: vec![Requirement {
                binary: "aws".into(),
                kind: RequirementKind::External,
            }],
        };
        let report = diagnose(&ctx, &paths(), &fs(&["/usr/bin/aws"]), &|_p| None);
        assert_eq!(
            report.items[0].resolution,
            Resolution::NotOnAppPath { path: "/usr/bin/aws".into() },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reqs(yaml: &str) -> Vec<ContextRequirements> {
        context_requirements(yaml).expect("parse")
    }

    const OIDC: &str = r#"
apiVersion: v1
kind: Config
contexts:
  - name: dev
    context:
      cluster: c
      user: oidc
users:
  - name: oidc
    user:
      exec:
        command: kubectl
        args: ["oidc-login", "get-token", "--oidc-issuer-url=https://x"]
"#;

    #[test]
    fn kubectl_plugin_needs_kubectl_and_the_krew_binary() {
        assert_eq!(
            reqs(OIDC),
            vec![ContextRequirements {
                context: "dev".into(),
                requirements: vec![
                    Requirement { binary: "kubectl".into(), kind: RequirementKind::Kubectl },
                    Requirement {
                        binary: "kubectl-oidc_login".into(),
                        kind: RequirementKind::KrewPlugin { plugin: "oidc-login".into() },
                    },
                ],
            }],
        );
    }

    #[test]
    fn a_context_with_no_exec_block_has_no_requirements() {
        let yaml = r#"
contexts:
  - name: plain
    context: { cluster: c, user: static }
users:
  - name: static
    user:
      token: abc
"#;
        assert_eq!(reqs(yaml)[0].requirements, vec![]);
    }

    #[test]
    fn a_cloud_cli_exec_is_external_not_installable() {
        let yaml = r#"
contexts:
  - name: eks
    context: { cluster: c, user: aws }
users:
  - name: aws
    user:
      exec:
        command: aws
        args: ["eks", "get-token", "--cluster-name", "prod"]
"#;
        assert_eq!(
            reqs(yaml)[0].requirements,
            vec![Requirement { binary: "aws".into(), kind: RequirementKind::External }],
        );
    }

    #[test]
    fn an_env_prefixed_command_resolves_to_the_real_binary() {
        let yaml = r#"
contexts:
  - name: eks
    context: { cluster: c, user: aws }
users:
  - name: aws
    user:
      exec:
        command: env
        args: ["AWS_PROFILE=prod", "aws", "eks", "get-token"]
"#;
        assert_eq!(
            reqs(yaml)[0].requirements,
            vec![Requirement { binary: "aws".into(), kind: RequirementKind::External }],
        );
    }

    #[test]
    fn an_absolute_path_command_is_checked_as_written() {
        let yaml = r#"
contexts:
  - name: gke
    context: { cluster: c, user: g }
users:
  - name: g
    user:
      exec:
        command: /opt/google-cloud-sdk/bin/gke-gcloud-auth-plugin
"#;
        assert_eq!(
            reqs(yaml)[0].requirements,
            vec![Requirement {
                binary: "/opt/google-cloud-sdk/bin/gke-gcloud-auth-plugin".into(),
                kind: RequirementKind::External,
            }],
        );
    }

    #[test]
    fn kubectl_with_only_flags_needs_only_kubectl() {
        let yaml = r#"
contexts:
  - name: k
    context: { cluster: c, user: u }
users:
  - name: u
    user:
      exec:
        command: kubectl
        args: ["--kubeconfig=/x"]
"#;
        assert_eq!(
            reqs(yaml)[0].requirements,
            vec![Requirement { binary: "kubectl".into(), kind: RequirementKind::Kubectl }],
        );
    }

    #[test]
    fn contexts_are_returned_in_document_order() {
        let yaml = r#"
contexts:
  - name: b
    context: { cluster: c, user: aws }
  - name: a
    context: { cluster: c, user: aws }
users:
  - name: aws
    user:
      exec: { command: aws, args: ["eks", "get-token"] }
"#;
        let names: Vec<_> = reqs(yaml).into_iter().map(|c| c.context).collect();
        assert_eq!(names, vec!["b", "a"]);
    }
}
