//! Toolbox diagnosis engine (pure).
//!
//! The top onboarding failure for exec-auth kubeconfigs is a missing tool:
//! `kubectl oidc-login` fails when `kubectl-oidc_login` isn't installed. This
//! module reads the exec-auth blocks of loaded kubeconfigs and turns each
//! context into the set of external binaries it depends on, classified by
//! whether srelens can install them (kubectl / krew plugins) or only report
//! them (cloud CLIs). Resolution of those requirements against the app's PATH
//! is a separate step; this half is pure string work and fully unit-tested.

use crate::kubeconfig::KubeError;
use serde::Deserialize;

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
