import { describe, it, expect } from "vitest";
import { nodeUsage, clusterCapacity } from "./k8sCapacity";
import type { NodeSummary, NodeMetric } from "./manifest";

function node(overrides: Partial<NodeSummary> = {}): NodeSummary {
  return {
    name: "node-1",
    status: "Ready",
    unschedulable: false,
    taints: 0,
    version: "v1.30.0",
    roles: "worker",
    age: "10d",
    allocatableCpuMillicores: 4000,
    allocatableMemoryMiB: 16000,
    allocatablePods: 110,
    ...overrides,
  };
}

function metric(overrides: Partial<NodeMetric> = {}): NodeMetric {
  return {
    name: "node-1",
    cpuMillicores: 2000,
    memoryMiB: 8000,
    ...overrides,
  };
}

describe("nodeUsage — the ordinary case", () => {
  it("divides usage by allocatable, as a percentage, unrounded", () => {
    const usage = nodeUsage(node(), metric(), 31);
    expect(usage.cpuPercent).toBe(50);
    expect(usage.memoryPercent).toBe(50);
    expect(usage.pods).toEqual({ used: 31, allocatable: 110 });
  });

  it("does not round — a third of allocatable stays a real fraction", () => {
    const usage = nodeUsage(
      node({ allocatableCpuMillicores: 3000 }),
      metric({ cpuMillicores: 1000 }),
      undefined,
    );
    expect(usage.cpuPercent).toBeCloseTo(33.333333, 5);
  });
});

describe("nodeUsage — no metric for the node", () => {
  it("is null, not zero — absence of a reading is not an idle reading", () => {
    const usage = nodeUsage(node(), undefined, undefined);
    expect(usage.cpuPercent).toBeNull();
    expect(usage.memoryPercent).toBeNull();
  });
});

describe("nodeUsage — allocatable of zero", () => {
  it("is null, not a division by zero", () => {
    const usage = nodeUsage(
      node({ allocatableCpuMillicores: 0, allocatableMemoryMiB: 0 }),
      metric(),
      undefined,
    );
    expect(usage.cpuPercent).toBeNull();
    expect(usage.memoryPercent).toBeNull();
  });
});

describe("nodeUsage — usage above allocatable", () => {
  it("reports honestly above 100, never clamped", () => {
    const usage = nodeUsage(
      node({ allocatableCpuMillicores: 1000, allocatableMemoryMiB: 1000 }),
      metric({ cpuMillicores: 1400, memoryMiB: 1900 }),
      undefined,
    );
    expect(usage.cpuPercent).toBe(140);
    expect(usage.memoryPercent).toBe(190);
  });
});

describe("nodeUsage — pods", () => {
  it("is null when the pod count for the node is unknown", () => {
    const usage = nodeUsage(node(), metric(), undefined);
    expect(usage.pods).toBeNull();
  });

  it("carries the raw used/allocatable pair when a count is known", () => {
    const usage = nodeUsage(node({ allocatablePods: 50 }), metric(), 31);
    expect(usage.pods).toEqual({ used: 31, allocatable: 50 });
  });
});

describe("clusterCapacity — the ordinary case", () => {
  it("sums usage and allocatable across every node reporting a metric", () => {
    const nodes = [
      node({ name: "a", allocatableCpuMillicores: 4000, allocatableMemoryMiB: 16000 }),
      node({ name: "b", allocatableCpuMillicores: 4000, allocatableMemoryMiB: 16000 }),
    ];
    const metrics = [
      metric({ name: "a", cpuMillicores: 1000, memoryMiB: 4000 }),
      metric({ name: "b", cpuMillicores: 3000, memoryMiB: 12000 }),
    ];
    const capacity = clusterCapacity(nodes, metrics);
    expect(capacity.cpu).toEqual({ usedMillicores: 4000, allocatableMillicores: 8000 });
    expect(capacity.memory).toEqual({ usedMiB: 16000, allocatableMiB: 32000 });
  });
});

describe("clusterCapacity — no node has a metric", () => {
  it("is null — the same absence rule as a single node, not a zero total", () => {
    const nodes = [node({ name: "a" }), node({ name: "b" })];
    const capacity = clusterCapacity(nodes, []);
    expect(capacity.cpu).toBeNull();
    expect(capacity.memory).toBeNull();
  });
});

describe("clusterCapacity — an empty cluster", () => {
  it("is null", () => {
    const capacity = clusterCapacity([], []);
    expect(capacity.cpu).toBeNull();
    expect(capacity.memory).toBeNull();
  });
});

describe("clusterCapacity — some nodes have metrics, others do not", () => {
  it("sums only the nodes that reported, on both sides of the ratio, so the total stays internally consistent", () => {
    const nodes = [
      node({ name: "a", allocatableCpuMillicores: 4000, allocatableMemoryMiB: 16000 }),
      // "b" has no metric — joined since the last scrape, say.
      node({ name: "b", allocatableCpuMillicores: 6000, allocatableMemoryMiB: 24000 }),
    ];
    const metrics = [metric({ name: "a", cpuMillicores: 1000, memoryMiB: 4000 })];
    const capacity = clusterCapacity(nodes, metrics);
    // Node "b"'s 6000m/24000MiB of capacity is excluded entirely, not folded
    // in as an allocatable with zero usage — that would understate the
    // percentage by inventing a reading nobody took.
    expect(capacity.cpu).toEqual({ usedMillicores: 1000, allocatableMillicores: 4000 });
    expect(capacity.memory).toEqual({ usedMiB: 4000, allocatableMiB: 16000 });
  });
});
