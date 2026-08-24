import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ClusterFacts, NodeSummary, PodSummary } from "@srelens/core";

// `vi.hoisted` because `vi.mock` is hoisted above every declaration in this
// file — the same pattern resourceList.test.tsx uses. Only the six capability
// wrappers are replaced; `nodeUsage`, `clusterCapacity` and `K8S_KIND` stay
// real, so these tests assert against core's arithmetic rather than a copy.
const core = vi.hoisted(() => ({
  listNodes: vi.fn(),
  nodeMetrics: vi.fn(),
  listPods: vi.fn(),
  listNamespaces: vi.fn(),
  listResource: vi.fn(),
  clusterFacts: vi.fn(),
}));
vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  ...core,
}));

import {
  OVERVIEW_KINDS,
  useClusterFacts,
  useNamespaceCount,
  useObjectCounts,
  useOverview,
  useOverviewNodes,
  useOverviewPods,
} from "./overview";

function aNode(name: string, over: Partial<NodeSummary> = {}): NodeSummary {
  return {
    name,
    status: "Ready",
    unschedulable: false,
    taints: 0,
    version: "v1.31.4",
    roles: "worker",
    age: "10d",
    allocatableCpuMillicores: 4000,
    allocatableMemoryMiB: 16000,
    allocatablePods: 50,
    ...over,
  };
}

function aPod(name: string, node: string, over: Partial<PodSummary> = {}): PodSummary {
  return {
    name,
    namespace: "default",
    phase: "Running",
    ready: "1/1",
    restarts: 0,
    node,
    age: "3d",
    image: "acme/api:1",
    ...over,
  };
}

const NO_FACTS: ClusterFacts = {
  context: "prod",
  provider: "",
  region: "",
  metricsServer: { state: "unknown", version: "" },
};

/** Every loader answers something harmless; each test overrides what it cares about. */
function allQuiet() {
  core.listNodes.mockResolvedValue({ nodes: [] });
  core.nodeMetrics.mockResolvedValue({ metrics: [] });
  core.listPods.mockResolvedValue({ pods: [] });
  core.listNamespaces.mockResolvedValue({ namespaces: [] });
  core.listResource.mockResolvedValue({ items: [] });
  core.clusterFacts.mockResolvedValue(NO_FACTS);
}

describe("useOverviewNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allQuiet();
  });

  it("pairs each node with its usage against its own allocatable", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("a1"), aNode("b2", { allocatableCpuMillicores: 8000 })] });
    core.nodeMetrics.mockResolvedValue({
      metrics: [
        { name: "a1", cpuMillicores: 2000, memoryMiB: 8000 },
        { name: "b2", cpuMillicores: 2000, memoryMiB: 4000 },
      ],
    });

    const { result } = renderHook(() => useOverviewNodes("prod", undefined));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.nodes.map((n) => n.node.name)).toEqual(["a1", "b2"]);
    expect(result.current.nodes[0].usage.cpuPercent).toBe(50);
    expect(result.current.nodes[1].usage.cpuPercent).toBe(25);
    expect(result.current.nodes[1].usage.memoryPercent).toBe(25);
    expect(result.current.capacity).toEqual({
      cpu: { usedMillicores: 4000, allocatableMillicores: 12000 },
      memory: { usedMiB: 12000, allocatableMiB: 32000 },
      nodesReporting: 2,
      nodesTotal: 2,
    });
  });

  it("keeps the rows when metrics-server is absent, and reads null rather than zero", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("a1")] });
    core.nodeMetrics.mockResolvedValue({ error: "the server could not find the requested resource" });

    const { result } = renderHook(() => useOverviewNodes("prod", undefined));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].usage.cpuPercent).toBeNull();
    expect(result.current.nodes[0].usage.memoryPercent).toBeNull();
    expect(result.current.metricsError).toContain("could not find");
    // The node list itself did not fail, so the table is not in an error state.
    expect(result.current.error).toBeUndefined();
    expect(result.current.capacity.nodesTotal).toBe(1);
    expect(result.current.capacity.cpu).toBeNull();
  });

  it("reports a node above its allocatable unrounded and uncapped", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("hot", { allocatableCpuMillicores: 1000 })] });
    core.nodeMetrics.mockResolvedValue({ metrics: [{ name: "hot", cpuMillicores: 1400, memoryMiB: 1234 }] });

    const { result } = renderHook(() => useOverviewNodes("prod", undefined));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.nodes[0].usage.cpuPercent).toBe(140);
    expect(result.current.nodes[0].usage.memoryPercent).toBeCloseTo(7.7125, 6);
  });

  it("counts the pods on each node, and a node with none reads zero", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("a1"), aNode("b2")] });
    const pods = [aPod("p1", "a1"), aPod("p2", "a1"), aPod("p3", "b2")];

    const { result } = renderHook(() => useOverviewNodes("prod", pods));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.nodes[0].usage.pods).toEqual({ used: 2, allocatable: 50 });
    expect(result.current.nodes[1].usage.pods).toEqual({ used: 1, allocatable: 50 });

    const empty = renderHook(() => useOverviewNodes("prod", [aPod("p1", "a1")]));
    await waitFor(() => expect(empty.result.current.status).toBe("ready"));
    expect(empty.result.current.nodes[1].usage.pods).toEqual({ used: 0, allocatable: 50 });
  });

  it("reads no pod count at all while the pod list is unknown", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("a1")] });

    const { result } = renderHook(() => useOverviewNodes("prod", undefined));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    // Not `{ used: 0 }`: nobody has told us there are no pods on this node.
    expect(result.current.nodes[0].usage.pods).toBeNull();
  });

  it("passes through a node that reports no allocatable pods rather than papering over it", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("a1", { allocatablePods: 0 })] });

    const { result } = renderHook(() => useOverviewNodes("prod", [aPod("p1", "a1"), aPod("p2", "a1")]));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.nodes[0].usage.pods).toEqual({ used: 2, allocatable: 0 });
  });

  it("empties the table and says why when the node list is refused", async () => {
    core.listNodes.mockResolvedValue({ error: 'nodes is forbidden: User "dev" cannot list resource "nodes"' });
    core.nodeMetrics.mockResolvedValue({ metrics: [{ name: "a1", cpuMillicores: 1, memoryMiB: 1 }] });

    const { result } = renderHook(() => useOverviewNodes("prod", undefined));
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.nodes).toEqual([]);
    expect(result.current.error).toContain("forbidden");
  });

  it("discards a node list that arrives after the reader moved to another cluster", async () => {
    let settleFirst: (value: { nodes: NodeSummary[] }) => void = () => {};
    core.listNodes.mockImplementationOnce(
      () => new Promise<{ nodes: NodeSummary[] }>((resolve) => { settleFirst = resolve; }),
    );
    core.listNodes.mockResolvedValue({ nodes: [aNode("staging-1")] });

    const { result, rerender } = renderHook(({ context }: { context: string }) => useOverviewNodes(context, undefined), {
      initialProps: { context: "prod" },
    });
    rerender({ context: "staging" });
    await waitFor(() => expect(result.current.nodes).toHaveLength(1));

    await act(async () => {
      settleFirst({ nodes: [aNode("prod-1"), aNode("prod-2")] });
    });

    expect(result.current.nodes.map((n) => n.node.name)).toEqual(["staging-1"]);
  });
});

describe("useOverviewPods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allQuiet();
  });

  it("lists every namespace's pods, and holds `undefined` until it knows", async () => {
    core.listPods.mockResolvedValue({ pods: [aPod("p1", "a1")] });

    const { result } = renderHook(() => useOverviewPods("prod"));
    expect(result.current.status).toBe("loading");
    // Not `[]` while loading: an empty list would count as "no pods" to every
    // consumer, which is the null-is-not-zero mistake one level up.
    expect(result.current.pods).toBeUndefined();

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(core.listPods).toHaveBeenCalledWith("prod", "");
    expect(result.current.pods).toHaveLength(1);
  });

  it("reports a refusal without inventing an empty cluster", async () => {
    core.listPods.mockResolvedValue({ error: "pods is forbidden" });

    const { result } = renderHook(() => useOverviewPods("prod"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.pods).toBeUndefined();
    expect(result.current.error).toContain("forbidden");
  });
});

describe("useNamespaceCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allQuiet();
  });

  it("counts them", async () => {
    core.listNamespaces.mockResolvedValue({ namespaces: ["default", "kube-system", "checkout"] });

    const { result } = renderHook(() => useNamespaceCount("prod"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.count).toBe(3);
  });

  it("has no count at all when the list is refused", async () => {
    core.listNamespaces.mockResolvedValue({ error: "namespaces is forbidden" });

    const { result } = renderHook(() => useNamespaceCount("prod"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.count).toBeNull();
  });
});

describe("useObjectCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allQuiet();
  });

  it("counts one kind per row, in the rail's order", async () => {
    core.listResource.mockImplementation((_context: string, kind: string) =>
      Promise.resolve({ items: kind === "Deployment" ? [{ name: "a" }, { name: "b" }] : [] }),
    );

    const { result } = renderHook(() => useObjectCounts("prod"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.counts.map((c) => c.slug)).toEqual(OVERVIEW_KINDS);
    expect(result.current.counts[0]).toEqual({ slug: "deployments", count: 2 });
  });

  it("keeps every other kind's count when one kind is refused", async () => {
    core.listResource.mockImplementation((_context: string, kind: string) =>
      kind === "Job"
        ? Promise.resolve({ error: 'jobs is forbidden: User "dev" cannot list resource "jobs"' })
        : Promise.resolve({ items: [{ name: "a" }] }),
    );

    const { result } = renderHook(() => useObjectCounts("prod"));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    const jobs = result.current.counts.find((c) => c.slug === "jobs");
    expect(jobs?.count).toBeNull();
    expect(jobs?.error).toContain("forbidden");
    for (const other of result.current.counts.filter((c) => c.slug !== "jobs")) {
      expect(other.count).toBe(1);
      expect(other.error).toBeUndefined();
    }
  });
});

describe("useClusterFacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allQuiet();
  });

  it("returns the control-plane facts", async () => {
    core.clusterFacts.mockResolvedValue({
      context: "prod",
      provider: "GKE",
      region: "europe-west4",
      metricsServer: { state: "present", version: "v1beta1" },
    });

    const { result } = renderHook(() => useClusterFacts("prod"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.facts?.provider).toBe("GKE");
    expect(result.current.facts?.metricsServer.version).toBe("v1beta1");
  });

  it("surfaces the wrapper's own error rather than presenting empty facts as an answer", async () => {
    core.clusterFacts.mockResolvedValue({ ...NO_FACTS, error: "connection refused" });

    const { result } = renderHook(() => useClusterFacts("prod"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toContain("connection refused");
  });
});

describe("useOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allQuiet();
  });

  // The property this module exists for. Classic's ClusterOverview fires six
  // calls in parallel and throws on the first error, so one refused list blanks
  // the entire dashboard.
  it("leaves every other section's data on screen when one loader fails", async () => {
    core.listNodes.mockResolvedValue({ error: 'nodes is forbidden: User "dev" cannot list resource "nodes"' });
    core.listPods.mockResolvedValue({ pods: [aPod("p1", "a1"), aPod("p2", "b2")] });
    core.listNamespaces.mockResolvedValue({ namespaces: ["default", "checkout"] });
    core.listResource.mockResolvedValue({ items: [{ name: "a" }, { name: "b" }, { name: "c" }] });
    core.clusterFacts.mockResolvedValue({
      context: "prod",
      provider: "kind",
      region: "",
      metricsServer: { state: "present", version: "v1beta1" },
    });

    const { result } = renderHook(() => useOverview("prod"));
    await waitFor(() => expect(result.current.nodes.status).toBe("error"));
    await waitFor(() => expect(result.current.namespaces.status).toBe("ready"));

    expect(result.current.nodes.nodes).toEqual([]);
    expect(result.current.nodes.error).toContain("forbidden");

    expect(result.current.pods.pods).toHaveLength(2);
    expect(result.current.namespaces.count).toBe(2);
    expect(result.current.objects.counts.every((c) => c.count === 3)).toBe(true);
    expect(result.current.facts.facts?.provider).toBe("kind");
  });

  it("feeds the pod list into the nodes' pod counts without a second list call", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("a1"), aNode("b2")] });
    core.listPods.mockResolvedValue({ pods: [aPod("p1", "a1"), aPod("p2", "a1"), aPod("p3", "b2")] });

    const { result } = renderHook(() => useOverview("prod"));
    await waitFor(() => expect(result.current.nodes.nodes[0]?.usage.pods).toEqual({ used: 2, allocatable: 50 }));

    expect(result.current.nodes.nodes[1].usage.pods).toEqual({ used: 1, allocatable: 50 });
    expect(core.listPods).toHaveBeenCalledTimes(1);
  });

  it("reloads every section at once", async () => {
    const { result } = renderHook(() => useOverview("prod"));
    await waitFor(() => expect(result.current.facts.status).toBe("ready"));

    act(() => result.current.reload());
    await waitFor(() => expect(core.listNodes).toHaveBeenCalledTimes(2));
    expect(core.listPods).toHaveBeenCalledTimes(2);
    expect(core.listNamespaces).toHaveBeenCalledTimes(2);
    expect(core.clusterFacts).toHaveBeenCalledTimes(2);
  });
});
