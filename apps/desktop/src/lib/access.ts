import { useEffect, useReducer } from "react";
import { invokeCapability, type Invoker } from "../transport/transport";
import { describeError } from "./errors";
import { notify } from "./notify";

export interface AccessCheck {
  verb: string;
  group?: string;
  resource: string;
  subresource?: string;
  namespace?: string;
  name?: string;
}

export interface AccessResult {
  allowed: boolean;
  denied: boolean;
  reason: string;
}

/** Batched SelfSubjectAccessReview via `k8s.canI`. Results align 1:1 with `checks`. */
export async function canI(
  context: string,
  checks: AccessCheck[],
  invoke: Invoker = invokeCapability,
): Promise<{ results?: AccessResult[]; error?: string }> {
  try {
    const out = await invoke<{ results: AccessResult[] }>("k8s.canI", { context, checks });
    return { results: out.results };
  } catch (e) {
    return { error: String(e) };
  }
}

/** Stable cache key for a check within a context. */
function keyOf(context: string, c: AccessCheck): string {
  return [context, c.namespace ?? "", c.verb, c.group ?? "", c.resource, c.subresource ?? "", c.name ?? ""].join("|");
}

const cache = new Map<string, AccessResult>();

/** Clear cached results for a context (on switch) or everything. */
export function clearAccessCache(context?: string): void {
  if (!context) {
    cache.clear();
    return;
  }
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${context}|`)) cache.delete(k);
  }
}

/** Drop one cached check — call after a surprise 403 so the control re-gates. */
export function invalidateAccess(context: string, c: AccessCheck): void {
  cache.delete(keyOf(context, c));
}

/** True when a raw error string is a Kubernetes Forbidden/403. */
export function isForbidden(error: string): boolean {
  return /forbidden|\b403\b/i.test(error);
}

/**
 * Report a failed mutating action: toast the actionable (describeError) message,
 * and if it was a 403, clear this context's access cache so the control re-gates.
 */
export function reportActionError(context: string, title: string, error: string): void {
  const friendly = describeError(error);
  notify.error(title, friendly.detail);
  if (isForbidden(error)) clearAccessCache(context);
}

/** Tooltip explaining a disabled control, only when the check RESOLVED denied. */
export function denyReason(
  access: { known: (c: AccessCheck) => boolean; allowed: (c: AccessCheck) => boolean },
  c: AccessCheck,
): string | undefined {
  return access.known(c) && !access.allowed(c)
    ? `You don't have permission to ${c.verb} ${c.resource}${c.namespace ? ` in ${c.namespace}` : ""}`
    : undefined;
}

/**
 * Preflight access for a set of checks. Batches the uncached ones into one
 * `k8s.canI` call and caches results. Unknown/loading ⇒ NOT allowed, so callers
 * keep controls disabled until the check resolves.
 */
export function useAccess(
  context: string,
  checks: AccessCheck[],
  invoke: Invoker = invokeCapability,
): {
  allowed: (c: AccessCheck) => boolean;
  reason: (c: AccessCheck) => string;
  known: (c: AccessCheck) => boolean;
  loading: boolean;
} {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const checksKey = checks.map((c) => keyOf(context, c)).join(";");

  useEffect(() => {
    const missing = checks.filter((c) => !cache.has(keyOf(context, c)));
    if (missing.length === 0) return;
    let active = true;
    void canI(context, missing, invoke).then((out) => {
      if (!active || !out.results) return;
      missing.forEach((c, i) => cache.set(keyOf(context, c), out.results![i]));
      forceUpdate();
    });
    return () => {
      active = false;
    };
    // Deps are intentionally [context, checksKey], not [invoke, checks]: a
    // fresh `invoke` function or `checks` array reference on every render
    // would otherwise retrigger this effect and loop forever. `checksKey`
    // already captures every semantic change to `checks` (including `name`),
    // so it alone is sufficient to decide when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, checksKey]);

  return {
    allowed: (c) => cache.get(keyOf(context, c))?.allowed ?? false,
    reason: (c) => cache.get(keyOf(context, c))?.reason ?? "",
    known: (c) => cache.has(keyOf(context, c)),
    loading: checks.some((c) => !cache.has(keyOf(context, c))),
  };
}

/** Action → RBAC (verb, group, resource, subresource) builders. */
export const rbac = {
  deletePod: (namespace: string): AccessCheck => ({ verb: "delete", resource: "pods", namespace }),
  evictPod: (namespace: string): AccessCheck => ({ verb: "create", resource: "pods", subresource: "eviction", namespace }),
  deleteResource: (group: string, resource: string, namespace?: string): AccessCheck => ({ verb: "delete", group, resource, namespace }),
  scale: (group: string, resource: string, namespace: string): AccessCheck => ({ verb: "patch", group, resource, subresource: "scale", namespace }),
  rolloutRestart: (group: string, resource: string, namespace: string): AccessCheck => ({ verb: "patch", group, resource, namespace }),
  edit: (group: string, resource: string, namespace?: string): AccessCheck => ({ verb: "patch", group, resource, namespace }),
  cordon: (): AccessCheck => ({ verb: "patch", resource: "nodes" }),
  drain: (): AccessCheck => ({ verb: "create", resource: "pods", subresource: "eviction" }),
  cronjobSuspend: (namespace: string): AccessCheck => ({ verb: "patch", group: "batch", resource: "cronjobs", namespace }),
  cronjobTrigger: (namespace: string): AccessCheck => ({ verb: "create", group: "batch", resource: "jobs", namespace }),
};

/** Kind → {group, resource} for the mutating kinds (mirrors backend gvk_for). */
export function kindToResource(kind: string): { group: string; resource: string } | null {
  const m: Record<string, { group: string; resource: string }> = {
    Pod: { group: "", resource: "pods" },
    Service: { group: "", resource: "services" },
    ConfigMap: { group: "", resource: "configmaps" },
    Secret: { group: "", resource: "secrets" },
    Namespace: { group: "", resource: "namespaces" },
    Node: { group: "", resource: "nodes" },
    PersistentVolumeClaim: { group: "", resource: "persistentvolumeclaims" },
    ServiceAccount: { group: "", resource: "serviceaccounts" },
    Deployment: { group: "apps", resource: "deployments" },
    StatefulSet: { group: "apps", resource: "statefulsets" },
    DaemonSet: { group: "apps", resource: "daemonsets" },
    ReplicaSet: { group: "apps", resource: "replicasets" },
    Job: { group: "batch", resource: "jobs" },
    CronJob: { group: "batch", resource: "cronjobs" },
    Ingress: { group: "networking.k8s.io", resource: "ingresses" },
    NetworkPolicy: { group: "networking.k8s.io", resource: "networkpolicies" },
    Role: { group: "rbac.authorization.k8s.io", resource: "roles" },
    RoleBinding: { group: "rbac.authorization.k8s.io", resource: "rolebindings" },
    ClusterRole: { group: "rbac.authorization.k8s.io", resource: "clusterroles" },
    ClusterRoleBinding: { group: "rbac.authorization.k8s.io", resource: "clusterrolebindings" },
  };
  return m[kind] ?? null;
}
