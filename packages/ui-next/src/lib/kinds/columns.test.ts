import { describe, it, expect } from "vitest";
import { podColumns, nodeColumns, type PodRow } from "./columns";

const pod = (over: Partial<PodRow> = {}): PodRow => ({
  name: "web-0", namespace: "default", phase: "Running", ready: "1/1",
  restarts: 0, node: "node-a", age: "3d", ...over,
});

describe("pod columns", () => {
  it("sorts ages by duration, not by the text that renders them", () => {
    const age = podColumns.find((c) => c.key === "age")!;
    const older = age.getSortValue!(pod({ age: "1y" }));
    const newer = age.getSortValue!(pod({ age: "300d" }));
    expect(Number(older)).toBeGreaterThan(Number(newer));
  });

  it("shows an em dash where metrics-server left no reading, not a bare zero", () => {
    const cpu = podColumns.find((c) => c.key === "cpu")!;
    expect(cpu.render!(pod())).toBe("—");
    expect(cpu.render!(pod({ cpu: 12 }))).toBe("12m");
  });

  it("sorts a missing reading below every real one", () => {
    const cpu = podColumns.find((c) => c.key === "cpu")!;
    expect(Number(cpu.getSortValue!(pod()))).toBeLessThan(Number(cpu.getSortValue!(pod({ cpu: 0 }))));
  });

  it("names the pod column Pod, so a reader knows what the list is of", () => {
    expect(podColumns[0].header).toBe("Pod");
  });
});

describe("node columns", () => {
  it("keeps no namespace column, because a node has none", () => {
    expect(nodeColumns.some((c) => c.key === "namespace")).toBe(false);
  });
});
