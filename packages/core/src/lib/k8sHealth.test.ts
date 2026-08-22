import { describe, it, expect } from "vitest";
import { conditionKind, containerStateText, orderPodConditions } from "./k8sHealth";

describe("orderPodConditions", () => {
  it("orders lifecycle conditions PodScheduled → Initialized → ContainersReady → Ready", () => {
    const shuffled = [
      { type: "Ready", status: "True" },
      { type: "PodScheduled", status: "True" },
      { type: "ContainersReady", status: "False" },
      { type: "Initialized", status: "True" },
    ];
    expect(orderPodConditions(shuffled).map((c) => c.type)).toEqual([
      "PodScheduled",
      "Initialized",
      "ContainersReady",
      "Ready",
    ]);
  });

  it("appends unknown condition types after the known lifecycle ones", () => {
    const conds = [
      { type: "DisruptionTarget", status: "True" },
      { type: "Ready", status: "True" },
      { type: "PodScheduled", status: "True" },
    ];
    expect(orderPodConditions(conds).map((c) => c.type)).toEqual([
      "PodScheduled",
      "Ready",
      "DisruptionTarget",
    ]);
  });
});

// classic's ResourceOverview.test.tsx did not cover conditionKind; written here
// against the body as moved (see k8sHealth.ts), not against the function name.
describe("conditionKind", () => {
  it("is a warning when the status itself is Unknown, regardless of the condition type", () => {
    expect(conditionKind({ type: "Ready", status: "Unknown" })).toBe("warning");
    expect(conditionKind({ type: "MemoryPressure", status: "Unknown" })).toBe("warning");
  });

  it("treats a True status on a normal (non-negative) type as healthy", () => {
    expect(conditionKind({ type: "Ready", status: "True" })).toBe("success");
    expect(conditionKind({ type: "Initialized", status: "True" })).toBe("success");
  });

  it("treats a False status on a normal (non-negative) type as unhealthy", () => {
    expect(conditionKind({ type: "Ready", status: "False" })).toBe("danger");
  });

  it("inverts the polarity for negatively-phrased types (Pressure/Unavailable/Failed/Dangling/NetworkUnavailable)", () => {
    // For a "bad thing" type, True means the bad thing IS happening (danger),
    // and False means it is NOT happening (success) — the opposite of a
    // normal type's polarity.
    expect(conditionKind({ type: "MemoryPressure", status: "True" })).toBe("danger");
    expect(conditionKind({ type: "MemoryPressure", status: "False" })).toBe("success");
    expect(conditionKind({ type: "DiskPressure", status: "True" })).toBe("danger");
    expect(conditionKind({ type: "NetworkUnavailable", status: "True" })).toBe("danger");
    expect(conditionKind({ type: "NetworkUnavailable", status: "False" })).toBe("success");
  });

  it("matches the negative-type regex case-insensitively", () => {
    expect(conditionKind({ type: "networkunavailable", status: "True" })).toBe("danger");
  });
});

// classic's ResourceOverview.test.tsx did not cover containerStateText either;
// written here against its actual branches.
describe("containerStateText", () => {
  it("reports a running container as success, with ready appended when ready", () => {
    expect(containerStateText({ state: { running: { startedAt: "2026-01-01T00:00:00Z" } } })).toEqual({
      text: "running",
      kind: "success",
    });
    expect(
      containerStateText({ state: { running: { startedAt: "2026-01-01T00:00:00Z" } }, ready: true }),
    ).toEqual({ text: "running, ready", kind: "success" });
  });

  it("reports a waiting container as warning, using the wait reason", () => {
    expect(containerStateText({ state: { waiting: { reason: "ContainerCreating" } } })).toEqual({
      text: "waiting - ContainerCreating",
      kind: "warning",
    });
  });

  it("falls back to a bare 'waiting' reason when none is given", () => {
    expect(containerStateText({ state: { waiting: {} } })).toEqual({
      text: "waiting - waiting",
      kind: "warning",
    });
  });

  it("reports a CrashLoopBackOff-style waiting reason as danger", () => {
    expect(containerStateText({ state: { waiting: { reason: "CrashLoopBackOff" } } })).toEqual({
      text: "waiting - CrashLoopBackOff",
      kind: "danger",
    });
  });

  it("reports a terminated container with a Completed reason as neutral", () => {
    expect(
      containerStateText({ state: { terminated: { reason: "Completed", exitCode: 0 } } }),
    ).toEqual({ text: "terminated - Completed (exit code: 0)", kind: "neutral" });
  });

  it("reports a terminated container with a non-Completed reason as danger, appends ready", () => {
    expect(
      containerStateText({
        state: { terminated: { reason: "Error", exitCode: 1 } },
        ready: true,
      }),
    ).toEqual({ text: "terminated, ready - Error (exit code: 1)", kind: "danger" });
  });

  it("omits the exit code segment when exitCode is unset", () => {
    expect(containerStateText({ state: { terminated: { reason: "OOMKilled" } } })).toEqual({
      text: "terminated - OOMKilled",
      kind: "danger",
    });
  });

  it("falls back to a bare 'terminated' reason when none is given", () => {
    expect(containerStateText({ state: { terminated: {} } })).toEqual({
      text: "terminated - terminated",
      kind: "danger",
    });
  });

  it("returns a dash with neutral kind when the state has none of running/waiting/terminated", () => {
    expect(containerStateText({ state: {} })).toEqual({ text: "—", kind: "neutral" });
    expect(containerStateText({})).toEqual({ text: "—", kind: "neutral" });
  });
});
