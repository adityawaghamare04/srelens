import { describe, it, expect } from "vitest";
import { podStatus, resourceStatusLine } from "./k8sStatus";
import type { K8sObject } from "./manifest";

/** A Deployment-shaped object: `spec.replicas` desired, the rest on `status`. */
const deployment = (spec: Record<string, unknown>, status: Record<string, unknown>): K8sObject => ({
  kind: "Deployment",
  metadata: { name: "checkout-api", namespace: "checkout" },
  spec,
  status,
});

const pod = (status: Record<string, unknown>, spec: Record<string, unknown> = {}): K8sObject => ({
  kind: "Pod",
  metadata: { name: "cart-session-store-0", namespace: "checkout" },
  spec,
  status,
});

/** One container status, as kubelet reports it. */
const container = (name: string, state: Record<string, unknown>, ready: boolean) => ({
  name,
  ready,
  restartCount: 0,
  state,
});

describe("resourceStatusLine — Deployment", () => {
  it("reads the mock's frame A: 9 of 12 ready is Degraded, danger-toned, and flagged", () => {
    const line = resourceStatusLine("Deployment", deployment({ replicas: 12 }, { readyReplicas: 9 }));
    expect(line).toEqual({
      status: "Degraded",
      health: "danger",
      readyText: "9/12 ready",
      flagged: true,
    });
  });

  it("calls a fully ready Deployment Running, success-toned, and unflagged", () => {
    expect(resourceStatusLine("Deployment", deployment({ replicas: 3 }, { readyReplicas: 3, availableReplicas: 3 }))).toEqual({
      status: "Running",
      health: "success",
      readyText: "3/3 ready",
      flagged: false,
    });
  });

  it("counts READY replicas, not available ones — the label says ready, so the number must be readyReplicas", () => {
    // The two fields are not the same: `availableReplicas` is the subset of
    // ready replicas that have also outlived `minReadySeconds`, so a healthy
    // rollout sits at ready > available for a while. A line labelled "ready"
    // that printed the available count would under-report during exactly the
    // window a reader is most likely to be watching it.
    const line = resourceStatusLine("Deployment", deployment({ replicas: 12 }, { readyReplicas: 12, availableReplicas: 9 }));
    expect(line?.readyText).toBe("12/12 ready");
    expect(line?.status).toBe("Running");
    expect(line?.flagged).toBe(false);
  });

  it("treats a Deployment scaled to zero as scaled down, not degraded — the list's dot agrees", () => {
    expect(resourceStatusLine("Deployment", deployment({ replicas: 0 }, {}))).toEqual({
      status: "Scaled down",
      health: "neutral",
      readyText: "0/0 ready",
      flagged: false,
    });
  });

  it("reads a missing status as zero ready rather than throwing", () => {
    expect(resourceStatusLine("Deployment", { kind: "Deployment", spec: { replicas: 2 } })).toEqual({
      status: "Degraded",
      health: "danger",
      readyText: "0/2 ready",
      flagged: true,
    });
  });
});

describe("resourceStatusLine — StatefulSet and ReplicaSet", () => {
  it("degrades a StatefulSet short of its desired replicas", () => {
    const sts: K8sObject = { kind: "StatefulSet", spec: { replicas: 3 }, status: { readyReplicas: 1 } };
    expect(resourceStatusLine("StatefulSet", sts)).toEqual({
      status: "Degraded",
      health: "danger",
      readyText: "1/3 ready",
      flagged: true,
    });
  });

  it("passes a fully ready ReplicaSet", () => {
    const rs: K8sObject = { kind: "ReplicaSet", spec: { replicas: 2 }, status: { readyReplicas: 2 } };
    expect(resourceStatusLine("ReplicaSet", rs)).toEqual({
      status: "Running",
      health: "success",
      readyText: "2/2 ready",
      flagged: false,
    });
  });

  it("calls a superseded ReplicaSet (zero desired) scaled down, not degraded", () => {
    const rs: K8sObject = { kind: "ReplicaSet", spec: { replicas: 0 }, status: {} };
    expect(resourceStatusLine("ReplicaSet", rs)?.flagged).toBe(false);
    expect(resourceStatusLine("ReplicaSet", rs)?.status).toBe("Scaled down");
  });
});

describe("resourceStatusLine — DaemonSet", () => {
  it("counts nodes, not replicas: numberReady out of desiredNumberScheduled", () => {
    const ds: K8sObject = {
      kind: "DaemonSet",
      status: { desiredNumberScheduled: 5, currentNumberScheduled: 5, numberReady: 3, numberAvailable: 3 },
    };
    expect(resourceStatusLine("DaemonSet", ds)).toEqual({
      status: "Degraded",
      health: "danger",
      readyText: "3/5 ready",
      flagged: true,
    });
  });

  it("does not flag a DaemonSet that matches no nodes at all", () => {
    const ds: K8sObject = { kind: "DaemonSet", status: { desiredNumberScheduled: 0, numberReady: 0 } };
    expect(resourceStatusLine("DaemonSet", ds)).toEqual({
      status: "Not scheduled",
      health: "neutral",
      readyText: "0/0 ready",
      flagged: false,
    });
  });
});

describe("resourceStatusLine — Pod", () => {
  it("reads the mock's frame B: a Running pod, 1/1 ready, success-toned and unflagged", () => {
    const running = pod({
      phase: "Running",
      containerStatuses: [container("redis", { running: { startedAt: "2026-01-01T00:00:00Z" } }, true)],
    });
    expect(resourceStatusLine("Pod", running)).toEqual({
      status: "Running",
      health: "success",
      readyText: "1/1 ready",
      flagged: false,
    });
  });

  it("flags a Pending pod, warning-toned", () => {
    expect(resourceStatusLine("Pod", pod({ phase: "Pending" }))).toEqual({
      status: "Pending",
      health: "warning",
      readyText: null,
      flagged: true,
    });
  });

  it("does NOT flag a Succeeded pod — a green pill and a red dot on one header is the bug this replaces", () => {
    const succeeded = pod({
      phase: "Succeeded",
      containerStatuses: [container("runner", { terminated: { reason: "Completed", exitCode: 0 } }, false)],
    });
    const line = resourceStatusLine("Pod", succeeded);
    expect(line?.status).toBe("Succeeded");
    expect(line?.health).toBe("success");
    expect(line?.flagged).toBe(false);
  });

  it("flags a Failed pod, danger-toned", () => {
    const failed = pod({
      phase: "Failed",
      containerStatuses: [container("runner", { terminated: { reason: "Error", exitCode: 1 } }, false)],
    });
    expect(resourceStatusLine("Pod", failed)).toEqual({
      status: "Failed",
      health: "danger",
      readyText: "0/1 ready",
      flagged: true,
    });
  });

  it("shows the waiting reason, not the phase, for a crash-looping pod — and tones it danger", () => {
    const crashing = pod({
      phase: "Running",
      containerStatuses: [
        container("api", { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s" } }, false),
      ],
    });
    expect(resourceStatusLine("Pod", crashing)).toEqual({
      status: "CrashLoopBackOff",
      health: "danger",
      readyText: "0/1 ready",
      flagged: true,
    });
  });

  it("shows a non-backoff waiting reason as a warning, not a failure", () => {
    const starting = pod({
      phase: "Pending",
      containerStatuses: [container("api", { waiting: { reason: "ContainerCreating" } }, false)],
    });
    expect(resourceStatusLine("Pod", starting)).toEqual({
      status: "ContainerCreating",
      health: "warning",
      readyText: "0/1 ready",
      flagged: true,
    });
  });

  it("ignores a waiting container once the pod has reached a terminal phase", () => {
    // A Succeeded pod's containers are terminated; a stray waiting entry must
    // not drag a finished pod back to "not ready" and re-earn it a dot.
    const done = pod({
      phase: "Succeeded",
      containerStatuses: [container("api", { waiting: { reason: "CrashLoopBackOff" } }, false)],
    });
    expect(resourceStatusLine("Pod", done)?.status).toBe("Succeeded");
    expect(resourceStatusLine("Pod", done)?.flagged).toBe(false);
  });

  it("counts the ready containers across a multi-container pod", () => {
    const sidecar = pod({
      phase: "Running",
      containerStatuses: [
        container("api", { running: {} }, true),
        container("envoy", { running: {} }, false),
      ],
    });
    expect(resourceStatusLine("Pod", sidecar)?.readyText).toBe("1/2 ready");
  });

  it("offers no ratio for a pod the kubelet has not reported containers for yet", () => {
    expect(resourceStatusLine("Pod", pod({ phase: "Pending" }))?.readyText).toBeNull();
  });

  it("calls a pod with no phase at all Unknown, and flags it", () => {
    expect(resourceStatusLine("Pod", pod({}))).toEqual({
      status: "Unknown",
      health: "danger",
      readyText: null,
      flagged: true,
    });
  });
});

describe("resourceStatusLine — Job and CronJob", () => {
  const job = (spec: Record<string, unknown>, status: Record<string, unknown>): K8sObject => ({
    kind: "Job",
    spec,
    status,
  });

  it("calls a completed Job Complete, success-toned and unflagged", () => {
    expect(resourceStatusLine("Job", job({ completions: 3 }, { succeeded: 3 }))).toEqual({
      status: "Complete",
      health: "success",
      readyText: "3/3 complete",
      flagged: false,
    });
  });

  it("flags a Job with a failed pod, danger-toned — the list's own rule", () => {
    expect(resourceStatusLine("Job", job({ completions: 1 }, { failed: 2, succeeded: 0 }))).toEqual({
      status: "Failed",
      health: "danger",
      readyText: "0/1 complete",
      flagged: true,
    });
  });

  it("does not flag a Job that is merely still running, though it tones it warning", () => {
    // Matches `jobFlagged` in the list exactly: only a failure earns the dot,
    // even though an in-flight Job's pill is amber.
    expect(resourceStatusLine("Job", job({}, { active: 1 }))).toEqual({
      status: "Active",
      health: "warning",
      readyText: "0/1 complete",
      flagged: false,
    });
  });

  it("defaults an unset completions count to one", () => {
    expect(resourceStatusLine("Job", job({}, { succeeded: 1 }))?.readyText).toBe("1/1 complete");
  });

  it("reads a CronJob's suspension, and gives it no ratio", () => {
    const suspended: K8sObject = { kind: "CronJob", spec: { suspend: true }, status: {} };
    expect(resourceStatusLine("CronJob", suspended)).toEqual({
      status: "Suspended",
      health: "neutral",
      readyText: null,
      flagged: false,
    });
  });

  it("calls an unsuspended CronJob Active, and never flags one", () => {
    const active: K8sObject = { kind: "CronJob", spec: {}, status: { active: [{ name: "run-1" }] } };
    expect(resourceStatusLine("CronJob", active)).toEqual({
      status: "Active",
      health: "success",
      readyText: null,
      flagged: false,
    });
  });
});

describe("resourceStatusLine — Node", () => {
  const node = (conditions: unknown[], spec: Record<string, unknown> = {}): K8sObject => ({
    kind: "Node",
    metadata: { name: "eu-w4-n2-standard-b5" },
    spec,
    status: { conditions },
  });

  it("reads readiness off the Ready condition", () => {
    expect(resourceStatusLine("Node", node([{ type: "Ready", status: "True" }]))).toEqual({
      status: "Ready",
      health: "success",
      readyText: null,
      flagged: false,
    });
  });

  it("flags a NotReady node, danger-toned", () => {
    expect(resourceStatusLine("Node", node([{ type: "MemoryPressure", status: "False" }, { type: "Ready", status: "False" }]))).toEqual({
      status: "NotReady",
      health: "danger",
      readyText: null,
      flagged: true,
    });
  });

  it("names a cordoned node the way kubectl does, and flags it warning — the list already badges it", () => {
    const cordoned = node([{ type: "Ready", status: "True" }], { unschedulable: true });
    expect(resourceStatusLine("Node", cordoned)).toEqual({
      status: "Ready,SchedulingDisabled",
      health: "warning",
      readyText: null,
      flagged: true,
    });
  });

  it("keeps danger over warning for a node that is both NotReady and cordoned", () => {
    const both = node([{ type: "Ready", status: "False" }], { unschedulable: true });
    expect(resourceStatusLine("Node", both)?.status).toBe("NotReady,SchedulingDisabled");
    expect(resourceStatusLine("Node", both)?.health).toBe("danger");
  });

  it("calls a node with no Ready condition Unknown", () => {
    expect(resourceStatusLine("Node", node([]))?.status).toBe("Unknown");
    expect(resourceStatusLine("Node", node([]))?.health).toBe("danger");
  });
});

describe("resourceStatusLine — kinds with no status line", () => {
  it("returns null for a kind that has no health of its own", () => {
    expect(resourceStatusLine("ConfigMap", { kind: "ConfigMap", metadata: { name: "app-config" } })).toBeNull();
    expect(resourceStatusLine("Service", { kind: "Service" })).toBeNull();
    expect(resourceStatusLine("Secret", { kind: "Secret" })).toBeNull();
  });

  it("returns null for a custom resource, rather than guessing at its status", () => {
    const cr: K8sObject = {
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Rollout",
      status: { readyReplicas: 1, phase: "Degraded" },
    };
    expect(resourceStatusLine("Rollout", cr)).toBeNull();
  });

  it("returns null for an empty kind, and never throws on an empty object", () => {
    expect(resourceStatusLine("", {})).toBeNull();
    expect(() => resourceStatusLine("Pod", {})).not.toThrow();
    expect(() => resourceStatusLine("Deployment", {})).not.toThrow();
  });
});

describe("podStatus — the one reading a list row and a fetched object share", () => {
  it("gives a crash-looping pod the same verdict the header derives from the object", () => {
    // The whole point of the shared function: `PodSummary` carries the phase
    // and the waiting reason, `K8sObject` carries the container statuses those
    // were summarised from, and both arrive here.
    expect(podStatus("Running", "CrashLoopBackOff")).toEqual({
      status: "CrashLoopBackOff",
      health: "danger",
      flagged: true,
    });
    const object: K8sObject = {
      kind: "Pod",
      status: {
        phase: "Running",
        containerStatuses: [{ name: "api", ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } }],
      },
    };
    const line = resourceStatusLine("Pod", object)!;
    const { readyText, ...verdict } = line;
    expect(verdict).toEqual(podStatus("Running", "CrashLoopBackOff"));
    expect(readyText).toBe("0/1 ready");
  });

  it("warns rather than fails for a pod still pulling or creating", () => {
    expect(podStatus("Pending", "ContainerCreating")).toEqual({
      status: "ContainerCreating",
      health: "warning",
      flagged: true,
    });
    expect(podStatus("Pending", "ImagePullBackOff")).toEqual({
      status: "ImagePullBackOff",
      health: "danger",
      flagged: true,
    });
  });

  it("falls back to the phase when no container is waiting", () => {
    expect(podStatus("Running", "")).toEqual({ status: "Running", health: "success", flagged: false });
    expect(podStatus("Running")).toEqual({ status: "Running", health: "success", flagged: false });
  });

  it("keeps a finished pod finished, whatever a stale waiting entry says", () => {
    expect(podStatus("Succeeded", "CrashLoopBackOff")).toEqual({
      status: "Succeeded",
      health: "success",
      flagged: false,
    });
    expect(podStatus("Failed", "CrashLoopBackOff")).toEqual({
      status: "Failed",
      health: "danger",
      flagged: true,
    });
  });

  it("calls an empty phase Unknown rather than rendering a blank pill", () => {
    expect(podStatus("", "")).toEqual({ status: "Unknown", health: "danger", flagged: true });
  });

  it("flags a phase word it does not recognise without inventing a colour for it", () => {
    // `podFlagged`'s rule verbatim: anything the phase table does not call
    // healthy earns the dot. The tone stays neutral because nothing has told
    // us it is red.
    expect(podStatus("Evicted", "")).toEqual({ status: "Evicted", health: "neutral", flagged: true });
  });
});

describe("the tone and the dot are paired structurally", () => {
  it("never draws a success-toned status with an unhealthy dot, across every kind and state", () => {
    const objects: [string, K8sObject][] = [
      ["Pod", pod({ phase: "Running", containerStatuses: [container("a", { running: {} }, true)] })],
      ["Pod", pod({ phase: "Succeeded" })],
      ["Pod", pod({ phase: "Pending" })],
      ["Pod", pod({ phase: "Failed" })],
      ["Deployment", deployment({ replicas: 3 }, { readyReplicas: 3 })],
      ["Deployment", deployment({ replicas: 3 }, { readyReplicas: 1 })],
      ["Deployment", deployment({ replicas: 0 }, {})],
      ["StatefulSet", { kind: "StatefulSet", spec: { replicas: 1 }, status: { readyReplicas: 1 } }],
      ["ReplicaSet", { kind: "ReplicaSet", spec: { replicas: 0 }, status: {} }],
      ["DaemonSet", { kind: "DaemonSet", status: { desiredNumberScheduled: 2, numberReady: 2 } }],
      ["DaemonSet", { kind: "DaemonSet", status: { desiredNumberScheduled: 2, numberReady: 0 } }],
      ["Job", { kind: "Job", spec: {}, status: { succeeded: 1 } }],
      ["Job", { kind: "Job", spec: {}, status: { active: 1 } }],
      ["Job", { kind: "Job", spec: {}, status: { failed: 1 } }],
      ["CronJob", { kind: "CronJob", spec: { suspend: true }, status: {} }],
      ["CronJob", { kind: "CronJob", spec: {}, status: {} }],
      ["Node", { kind: "Node", spec: {}, status: { conditions: [{ type: "Ready", status: "True" }] } }],
      ["Node", { kind: "Node", spec: { unschedulable: true }, status: { conditions: [{ type: "Ready", status: "True" }] } }],
      ["Node", { kind: "Node", spec: {}, status: { conditions: [] } }],
    ];
    for (const [kind, object] of objects) {
      const line = resourceStatusLine(kind, object)!;
      expect(line).not.toBeNull();
      if (line.health === "success") {
        expect({ kind, status: line.status, flagged: line.flagged }).toEqual({
          kind,
          status: line.status,
          flagged: false,
        });
      }
      // And a danger-toned state always earns the dot, in every direction.
      if (line.health === "danger") expect(line.flagged).toBe(true);
    }
  });
});
