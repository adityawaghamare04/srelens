/**
 * `HealthKind` is a severity, not a UI token: core has no React and may not
 * depend on either design's pill/badge type, so it declares its own instead of
 * importing classic's `StatusKind`. The five member names deliberately match
 * `StatusKind` (from `apps/desktop/src/ui/StatusPill.tsx`) and the kit's
 * equivalent, so both designs can pass a `HealthKind` value straight into
 * their own pill component with no mapping table. That overlap is a
 * convenience for today's two UIs, not a coupling — if either renames its
 * tokens, it maps at its own boundary, not here.
 */
import { asRecord, str } from "./k8sRaw";

export type HealthKind = "neutral" | "success" | "warning" | "danger" | "info";

/**
 * Classic's phase-to-tone mapping (`ResourceBrowser.tsx:135`), on the
 * `HealthKind` vocabulary above — the names already match one-for-one, so
 * either design passes the result straight into its own pill.
 *
 * `Ready`/`NotReady` are here because a Node reports readiness where a Pod
 * reports a phase, and both go through this one table; a Pod never reports
 * either, and a Node never reports `Running`.
 */
export function phaseKind(phase: string): HealthKind {
  switch (phase) {
    case "Running":
    case "Succeeded":
    case "Ready":
      return "success";
    case "Pending":
      return "warning";
    case "Failed":
    case "Unknown":
    case "NotReady":
      return "danger";
    default:
      return "neutral";
  }
}

export interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export function conditionKind(c: Condition): HealthKind {
  const negative = /Pressure|Unavailable|Failed|Dangling|NetworkUnavailable/i.test(c.type);
  if (c.status === "Unknown") return "warning";
  const good = c.status === "True" ? !negative : negative;
  return good ? "success" : "danger";
}

// The pod lifecycle, in the order kubelet reports it.
const POD_CONDITION_ORDER = ["PodScheduled", "Initialized", "ContainersReady", "Ready"];

/**
 * Sort pod conditions into lifecycle order (PodScheduled → Initialized →
 * ContainersReady → Ready); any other condition types keep their relative order
 * after the known lifecycle ones.
 */
export function orderPodConditions(conditions: Condition[]): Condition[] {
  const rank = (type: string) => {
    const index = POD_CONDITION_ORDER.indexOf(type);
    return index === -1 ? POD_CONDITION_ORDER.length : index;
  };
  return conditions
    .map((condition, index) => ({ condition, index }))
    .sort((a, b) => rank(a.condition.type) - rank(b.condition.type) || a.index - b.index)
    .map(({ condition }) => condition);
}

/** Describe a container's runtime state, e.g. "running, ready". */
export function containerStateText(st: Record<string, unknown>): { text: string; kind: HealthKind } {
  const state = asRecord(st.state);
  const ready = st.ready === true ? ", ready" : "";
  if ("running" in state) return { text: `running${ready}`, kind: "success" };
  if ("waiting" in state) {
    const reason = str(asRecord(state.waiting).reason) || "waiting";
    return { text: `waiting - ${reason}`, kind: reason.includes("BackOff") ? "danger" : "warning" };
  }
  if ("terminated" in state) {
    const t = asRecord(state.terminated);
    const reason = str(t.reason) || "terminated";
    const code = t.exitCode != null ? ` (exit code: ${str(t.exitCode)})` : "";
    return {
      text: `terminated${ready} - ${reason}${code}`,
      kind: reason === "Completed" ? "neutral" : "danger",
    };
  }
  return { text: "—", kind: "neutral" };
}
