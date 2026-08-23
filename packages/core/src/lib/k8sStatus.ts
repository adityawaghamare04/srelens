/**
 * One resource's status line, derived from a fetched object rather than from a
 * list row.
 *
 * Every health predicate srelens already had — `podFlagged`,
 * `deploymentFlagged` and their siblings in the new design's column table — is
 * typed on a *summary row* the backend built (`PodSummary`, `DeploymentSummary`
 * …). A detail pane holds a `K8sObject` instead, and has no row to ask. This
 * module answers the same questions off the object, reusing the rules rather
 * than restating them: `phaseKind` for a phase word's tone, `containerStateText`
 * for a waiting container's.
 *
 * The word, the tone and the flag are decided together, in one branch per kind.
 * That is deliberate: they were once derived by separate functions, and a
 * `Succeeded` pod ended up with a green pill and a red "needs attention" dot at
 * the same time. Two readings of one fact can disagree; one reading cannot.
 */
import { containerStateText, phaseKind, type HealthKind } from "./k8sHealth";
import { asArray, asRecord, str } from "./k8sRaw";
import type { K8sObject } from "./manifest";

export interface ResourceStatusLine {
  /**
   * The kind's own status word — "Running", "Degraded", "Pending",
   * "Succeeded", "Failed", "Complete", "Suspended", "Ready,SchedulingDisabled".
   * One kind's vocabulary is not another's; this is whatever that kind calls
   * the state it is in.
   */
  status: string;
  /** Tone for the word, and for the unhealthy dot when `flagged`. */
  health: HealthKind;
  /**
   * The whole ready phrase, its noun included — "9/12 ready", "1/1 ready",
   * "3/3 complete" — for rendering verbatim, or `null` where the kind has no
   * such count. The noun is part of the string because it is not "ready" for
   * every kind: a Job counts completions, not readiness.
   */
  readyText: string | null;
  /**
   * Whether the resource needs attention — the header's leading dot. Never
   * true for a state whose own tone is `success`, and never derived
   * independently of `health`.
   */
  flagged: boolean;
}

/** A count off `status`/`spec`, absent meaning zero (as the backend's list summaries read it). */
function count(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ready-out-of-desired, shared by every kind that scales: fewer ready than
 * desired is Degraded, which is `deploymentFlagged`/`statefulSetFlagged`/
 * `daemonSetFlagged`'s rule (`ready < desired`) read off the object.
 *
 * Nothing desired is not a failure — a Deployment scaled to zero, or a
 * DaemonSet whose selector matches no node, is doing exactly what it was
 * asked. The list's flagged rules agree: `0 < 0` is false, so no dot.
 */
function scaledStatus(ready: number, desired: number, zeroWord: string): ResourceStatusLine {
  const readyText = `${ready}/${desired} ready`;
  if (desired === 0) return { status: zeroWord, health: "neutral", readyText, flagged: false };
  if (ready < desired) return { status: "Degraded", health: "danger", readyText, flagged: true };
  return { status: "Running", health: "success", readyText, flagged: false };
}

/**
 * A workload's ready replicas out of its desired ones.
 *
 * `status.readyReplicas`, NOT `status.availableReplicas`. They are different
 * fields: available is the subset of ready replicas that have also outlived
 * `minReadySeconds`, so a healthy rollout sits at ready > available for a
 * while. A line that says "ready" has to count the ready ones — the backend's
 * `DeploymentSummary.ready` reads the same field, so the header and the list
 * agree on one number.
 */
function replicaStatus(object: K8sObject): ResourceStatusLine {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  return scaledStatus(count(status.readyReplicas), count(spec.replicas), "Scaled down");
}

/** A DaemonSet counts nodes, not replicas: `numberReady` of `desiredNumberScheduled`. */
function daemonSetStatus(object: K8sObject): ResourceStatusLine {
  const status = asRecord(object.status);
  return scaledStatus(count(status.numberReady), count(status.desiredNumberScheduled), "Not scheduled");
}

/** The phases past which a pod is finished, and a container state cannot speak for it. */
const TERMINAL_POD_PHASES = ["Succeeded", "Failed"];

/**
 * A pod's phase, or the reason a container is stuck waiting.
 *
 * `status.phase` alone says "Running" for a pod whose only container is in
 * `CrashLoopBackOff`, which is the opposite of what the reader needs; kubectl
 * shows the waiting reason for the same reason. The tone of that reason comes
 * from `containerStateText`, which already draws the BackOff/other line — this
 * takes its verdict rather than restating it.
 *
 * A terminal pod is left alone: its containers are terminated, and a stale
 * waiting entry must not drag a finished pod back to unhealthy.
 */
function podStatus(object: K8sObject): ResourceStatusLine {
  const status = asRecord(object.status);
  const statuses = asArray(status.containerStatuses).map(asRecord);
  const ready = statuses.filter((c) => c.ready === true).length;
  // No container statuses at all means the kubelet has not reported yet —
  // "0/0 ready" would read as a fact when it is an absence.
  const readyText = statuses.length > 0 ? `${ready}/${statuses.length} ready` : null;

  const phase = str(status.phase) || "Unknown";
  const waiting = TERMINAL_POD_PHASES.includes(phase)
    ? undefined
    : statuses.find((c) => str(asRecord(asRecord(c.state).waiting).reason) !== "");
  if (waiting) {
    const reason = str(asRecord(asRecord(waiting.state).waiting).reason);
    const health = containerStateText(waiting).kind;
    return { status: reason, health, readyText, flagged: health !== "success" };
  }

  const health = phaseKind(phase);
  // `podFlagged`'s rule exactly: anything the phase table does not call
  // healthy earns the dot, so a `Succeeded` pod's green pill and its (absent)
  // dot can never disagree.
  return { status: phase, health, readyText, flagged: health !== "success" };
}

/**
 * A Job's outcome, on the list's own rule (`jobColumns`' status pill and
 * `jobFlagged`): a failure is a failure, an in-flight Job is amber but is NOT
 * flagged — still running is not yet wrong — and anything else has finished.
 */
function jobStatus(object: K8sObject): ResourceStatusLine {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  // An unset `completions` means one, per the Job API's own default.
  const completions = spec.completions != null ? count(spec.completions) : 1;
  const readyText = `${count(status.succeeded)}/${completions} complete`;
  if (count(status.failed) > 0) return { status: "Failed", health: "danger", readyText, flagged: true };
  if (count(status.active) > 0) return { status: "Active", health: "warning", readyText, flagged: false };
  return { status: "Complete", health: "success", readyText, flagged: false };
}

/**
 * A CronJob is suspended or it is not — the list's two pills. It has no
 * unhealthy state of its own (a CronJob deliberately has no `flagged` rule:
 * the health lives in the Jobs it spawns), and no ready count.
 */
function cronJobStatus(object: K8sObject): ResourceStatusLine {
  const suspended = asRecord(object.spec).suspend === true;
  return suspended
    ? { status: "Suspended", health: "neutral", readyText: null, flagged: false }
    : { status: "Active", health: "success", readyText: null, flagged: false };
}

/**
 * A node's readiness, as the backend's `NodeSummary.status` derives it: the
 * `Ready` condition True is "Ready", any other value "NotReady", and no such
 * condition at all "Unknown".
 *
 * Cordoning is appended the way kubectl prints it, and warns: the list already
 * badges `SchedulingDisabled` in the warning tone, and a node that is refusing
 * new pods is a thing the reader wants marked. A node that is also NotReady
 * keeps the worse of the two tones.
 */
function nodeStatus(object: K8sObject): ResourceStatusLine {
  const conditions = asArray(asRecord(object.status).conditions).map(asRecord);
  const ready = conditions.find((c) => str(c.type) === "Ready");
  const word = ready === undefined ? "Unknown" : str(ready.status) === "True" ? "Ready" : "NotReady";
  const readiness = phaseKind(word);
  const cordoned = asRecord(object.spec).unschedulable === true;
  if (!cordoned) return { status: word, health: readiness, readyText: null, flagged: readiness !== "success" };
  const health = readiness === "danger" ? "danger" : "warning";
  return { status: `${word},SchedulingDisabled`, health, readyText: null, flagged: true };
}

/**
 * The status line for a fetched resource, or `null` for a kind that has none.
 *
 * `kind` is passed rather than read off `object.kind` for the same reason the
 * detail bodies take it: the caller already knows which kind it asked for, and
 * a `K8sObject` is whatever JSON came back.
 *
 * A kind that is not listed here is not a gap. A ConfigMap has no health, and
 * a custom resource's `status` is its own CRD's business — a `status.phase`
 * that happens to read "Degraded" on some operator's object means whatever
 * that operator decided. Returning `null` says "this pane draws no status
 * line", which is the honest answer; guessing would put a red dot on a healthy
 * resource.
 */
export function resourceStatusLine(kind: string, object: K8sObject): ResourceStatusLine | null {
  switch (kind) {
    case "Pod":
      return podStatus(object);
    case "Deployment":
    case "StatefulSet":
    case "ReplicaSet":
      return replicaStatus(object);
    case "DaemonSet":
      return daemonSetStatus(object);
    case "Job":
      return jobStatus(object);
    case "CronJob":
      return cronJobStatus(object);
    case "Node":
      return nodeStatus(object);
    default:
      return null;
  }
}
