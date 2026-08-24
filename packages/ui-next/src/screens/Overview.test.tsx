import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Only the capability wrappers are replaced. `nodeUsage`, `clusterCapacity`,
// `nodeStatus`, `podStatus` and `resourceStatusLine` stay real, so every
// assertion below is against core's own arithmetic and core's own status
// vocabulary rather than a copy of either.
const core = vi.hoisted(() => ({
  listNodes: vi.fn(),
  nodeMetrics: vi.fn(),
  listPods: vi.fn(),
  listNamespaces: vi.fn(),
  listResource: vi.fn(),
  clusterFacts: vi.fn(),
  cordonNode: vi.fn(),
  drainNode: vi.fn(),
  copyKubectlCommand: vi.fn(),
}));
vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  ...core,
}));

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.scrollIntoView ??= () => {};
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};

import {
  resourceStatusLine,
  type ClusterContext,
  type ClusterFacts,
  type K8sObject,
  type NodeSummary,
  type PodSummary,
} from "@srelens/core";
import { Overview } from "./Overview";
import { ConsoleProvider } from "../console";
import { defaultState } from "../lib/tabs";
import * as store from "../lib/tabsStore";
import { resetContexts, setContexts, setKubeconfigFiles } from "../lib/clusters";

const CTX: ClusterContext = {
  name: "prod-eu",
  stableId: "prod",
  cluster: "prod",
  server: "https://prod",
  isCurrent: true,
};

const ROUTE = "/overview";

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

/** The three-node cluster every test starts from: all Ready, all reporting. */
const NODES = [aNode("n1"), aNode("n2"), aNode("n3")];
const METRICS = NODES.map((n) => ({ name: n.name, cpuMillicores: 2800, memoryMiB: 12000 }));
const PODS = [
  aPod("api-1", "n1"),
  aPod("api-2", "n1"),
  aPod("web-1", "n2"),
  // Phase `Running` with a waiting container: core calls this
  // `CrashLoopBackOff` and flags it, which is the one unhealthy pod here.
  aPod("worker-1", "n3", { phase: "Running", ready: "0/1", waitingReason: "CrashLoopBackOff" }),
];

const NO_FACTS: ClusterFacts = {
  context: "prod-eu",
  provider: "",
  region: "",
  metricsServer: { state: "unknown", version: "" },
};

function quiet() {
  core.listNodes.mockResolvedValue({ nodes: NODES });
  core.nodeMetrics.mockResolvedValue({ metrics: METRICS });
  core.listPods.mockResolvedValue({ pods: PODS });
  core.listNamespaces.mockResolvedValue({ namespaces: ["default", "kube-system", "prod", "obs"] });
  core.listResource.mockResolvedValue({ items: [] });
  core.clusterFacts.mockResolvedValue(NO_FACTS);
  core.cordonNode.mockResolvedValue({ ok: true });
  core.drainNode.mockResolvedValue({ evicted: 3, skipped: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  quiet();
  resetContexts();
  setContexts([CTX]);
  setKubeconfigFiles(["/home/u/.kube/config"]);
  store.setState(defaultState([CTX]));
});

function open() {
  store.openTab(ROUTE);
  return render(
    <ConsoleProvider>
      <Overview route={ROUTE} />
    </ConsoleProvider>,
  );
}

/** One tile of the capacity strip, found by the label above its figure. */
function tile(label: string): HTMLElement {
  const strip = document.querySelector('[data-slot="capacity"]');
  if (!strip) throw new Error("no capacity strip on screen");
  const found = within(strip as HTMLElement).getByText(label).closest(".stat");
  if (!found) throw new Error(`no ${label} tile`);
  return found as HTMLElement;
}

const value = (label: string) => tile(label).querySelector(".stat-value")?.textContent;
const caption = (label: string) => {
  const parts = Array.from(tile(label).children);
  // The delta is the third child when there is one — label, value, delta.
  return parts.length > 2 ? (parts[2].textContent ?? null) : null;
};
const tone = (label: string) => tile(label).getAttribute("data-tone");

const rowFor = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const headers = () =>
  Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
const cells = (row: HTMLElement) => Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
const dialog = () => document.querySelector('[data-slot="dialog-content"]') as HTMLElement | null;

describe("Overview — the capacity strip", () => {
  it("counts the cluster, and says in the caption what is wrong with it", async () => {
    open();
    await waitFor(() => expect(value("Nodes")).toBe("3"));

    // Every node is Ready: the caption says so, in the ok tone.
    expect(caption("Nodes")).toBe("all ready");
    expect(tone("Nodes")).toBe("ok");

    // One of the four pods is in CrashLoopBackOff, which core flags.
    expect(value("Pods")).toBe("4");
    expect(caption("Pods")).toBe("1 not ready");
    expect(tone("Pods")).toBe("sev");

    // The one tile the design gives no caption at all.
    expect(value("Namespaces")).toBe("4");
    expect(caption("Namespaces")).toBeNull();
  });

  it("says how many nodes are not ready rather than that they all are", async () => {
    core.listNodes.mockResolvedValue({
      nodes: [aNode("n1"), aNode("n2", { status: "NotReady" }), aNode("n3", { status: "NotReady" })],
    });
    open();

    await waitFor(() => expect(caption("Nodes")).toBe("2 not ready"));
    expect(tone("Nodes")).toBe("sev");
  });

  it("reads a cordoned node as cordoned, not as not ready", async () => {
    core.listNodes.mockResolvedValue({
      nodes: [aNode("n1"), aNode("n2"), aNode("n3", { unschedulable: true })],
    });
    open();

    await waitFor(() => expect(caption("Nodes")).toBe("1 cordoned"));
    expect(tone("Nodes")).toBe("warn");
  });

  it("shows CPU and memory as a share of what the cluster allocated", async () => {
    open();

    // 3 nodes x 2800m of 4000m allocatable.
    await waitFor(() => expect(value("CPU")).toBe("70%"));
    expect(caption("CPU")).toBe("8.4 / 12 cores");
    expect(tone("CPU")).toBe("warn");

    // 3 nodes x 12000MiB of 16000MiB allocatable.
    expect(value("Memory")).toBe("75%");
    expect(caption("Memory")).toBe("35.2Gi / 46.9Gi");
    expect(tone("Memory")).toBe("warn");
  });

  it("qualifies a partial total instead of showing it as the whole cluster", async () => {
    // Two of three nodes reported: the sums describe those two only.
    core.nodeMetrics.mockResolvedValue({ metrics: METRICS.slice(0, 2) });
    open();

    await waitFor(() => expect(value("CPU")).toBe("70%"));
    expect(caption("CPU")).toBe("5.6 / 8 cores · 2 of 3 nodes reporting");
    expect(caption("Memory")).toBe("23.4Gi / 31.3Gi · 2 of 3 nodes reporting");
  });

  it("reads a cluster with no metrics as no reading, never as 0%", async () => {
    core.nodeMetrics.mockResolvedValue({ error: "the server could not find the requested resource" });
    open();

    await waitFor(() => expect(value("CPU")).toBe("No reading"));
    expect(value("Memory")).toBe("No reading");
    // No figure at all, and no caption pretending to a total.
    expect(caption("CPU")).toBeNull();
    expect(caption("Memory")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    // The absence is the rail's to state, once — not five tiles announcing it.
    expect(screen.queryByText(/metrics-server/i)).toBeNull();
  });

  it("does not count a refused list as an empty cluster", async () => {
    core.listNamespaces.mockResolvedValue({ error: "namespaces is forbidden" });
    open();

    await waitFor(() => expect(value("Namespaces")).toBe("No reading"));
    // The other tiles are untouched by that one refusal.
    expect(value("Nodes")).toBe("3");
    expect(value("Pods")).toBe("4");
  });
});

describe("Overview — the nodes table", () => {
  it("draws the design's columns, in its order", async () => {
    open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());
    expect(headers()).toEqual(["Name", "Pool", "State", "CPU", "Memory", "Pods", ""]);
  });

  it("reads each node's own state, usage and pod count", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("n1")] });
    core.nodeMetrics.mockResolvedValue({
      metrics: [{ name: "n1", cpuMillicores: 3520, memoryMiB: 11840 }],
    });
    open();

    await waitFor(() => expect(rowFor("n1")).toBeTruthy());
    const row = rowFor("n1");
    // 3520/4000 = 88%, 11840/16000 = 74%, two of the four pods are on n1.
    expect(within(row).getByRole("meter", { name: "n1 CPU" }).getAttribute("aria-valuetext")).toBe("88%");
    expect(within(row).getByRole("meter", { name: "n1 memory" }).getAttribute("aria-valuetext")).toBe("74%");
    expect(cells(row)[5]).toBe("2/50");
    expect(within(row).getByText("Ready")).toBeTruthy();
  });

  it("takes the state word and its tone from core, never from a table of its own", async () => {
    core.listNodes.mockResolvedValue({
      nodes: [aNode("n1", { unschedulable: true }), aNode("n2", { status: "NotReady" }), aNode("n3")],
    });
    open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());

    /** The same node as a fetched object, read by the function a detail pane reads. */
    const asObject = (ready: boolean, unschedulable: boolean): K8sObject =>
      ({
        apiVersion: "v1",
        kind: "Node",
        metadata: { name: "n" },
        spec: { unschedulable },
        status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] },
      }) as unknown as K8sObject;

    const cordoned = resourceStatusLine("Node", asObject(true, true));
    const broken = resourceStatusLine("Node", asObject(false, false));
    const healthy = resourceStatusLine("Node", asObject(true, false));
    expect([cordoned, broken, healthy].every(Boolean)).toBe(true);

    // The word AND the tone, for all three states core distinguishes: a
    // cordoned node is warning, a NotReady one is danger, and a hand-paired
    // table that called them both "not Ready, so warn" would disagree here.
    const pill = (node: string, word: string) =>
      within(rowFor(node)).getByText(word).closest(".status");
    expect(pill("n1", cordoned!.status)?.getAttribute("data-kind")).toBe(cordoned!.health);
    expect(pill("n2", broken!.status)?.getAttribute("data-kind")).toBe(broken!.health);
    expect(pill("n3", healthy!.status)?.getAttribute("data-kind")).toBe(healthy!.health);
    expect(cordoned!.health).not.toBe(broken!.health);

    // Coloured and bold only where core called the state bad.
    expect(pill("n1", cordoned!.status)?.getAttribute("data-bad")).toBe("true");
    expect(pill("n2", broken!.status)?.getAttribute("data-bad")).toBe("true");
    expect(pill("n3", healthy!.status)?.getAttribute("data-bad")).toBeNull();
  });

  it("marks only the node that needs attention", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("n1"), aNode("n2", { status: "NotReady" })] });
    open();
    await waitFor(() => expect(rowFor("n2")).toBeTruthy());

    expect(within(rowFor("n2")).getByText("Needs attention")).toBeTruthy();
    expect(within(rowFor("n1")).queryByText("Needs attention")).toBeNull();
  });

  it("reads a node with no metric as no reading, not as an idle node", async () => {
    core.nodeMetrics.mockResolvedValue({ metrics: [METRICS[0]] });
    open();
    await waitFor(() => expect(rowFor("n2")).toBeTruthy());

    const row = rowFor("n2");
    expect(cells(row)[3]).toBe("No reading");
    expect(cells(row)[4]).toBe("No reading");
    // Not an empty meter, which reads as a measured zero.
    expect(within(row).queryByRole("meter")).toBeNull();
    // The node that did report still has both of its meters.
    expect(within(rowFor("n1")).getByRole("meter", { name: "n1 CPU" })).toBeTruthy();
  });

  it("reads a node that reported no allocatable pods as no reading, not as 2/0", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("n1", { allocatablePods: 0 })] });
    open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());

    expect(cells(rowFor("n1"))[5]).toBe("No reading");
    expect(within(rowFor("n1")).queryByText("2/0")).toBeNull();
  });

  it("passes a node over its limit through at its true percentage", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("n1")] });
    core.nodeMetrics.mockResolvedValue({
      metrics: [{ name: "n1", cpuMillicores: 5600, memoryMiB: 8000 }],
    });
    open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());

    const meter = within(rowFor("n1")).getByRole("meter", { name: "n1 CPU" });
    // The reading is honest; only the bar the meter draws is clamped.
    expect(meter.getAttribute("aria-valuetext")).toBe("140%");
    expect(meter.getAttribute("aria-valuenow")).toBe("100");
  });

  it("shows nothing in Pool rather than guessing one", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("eu-w4-c3-standard-a1", { roles: "worker" })] });
    open();
    await waitFor(() => expect(rowFor("eu-w4-c3-standard-a1")).toBeTruthy());

    const pool = cells(rowFor("eu-w4-c3-standard-a1"))[1];
    expect(pool).toBe("—");
    // Neither the naming convention in the node's name nor its roles.
    expect(pool).not.toContain("c3-standard");
    expect(pool).not.toContain("worker");
  });

  it("keeps the table when the metrics fail, and empties it only when the node list does", async () => {
    core.nodeMetrics.mockResolvedValue({ error: "metrics API unavailable" });
    const { unmount } = open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());
    expect(cells(rowFor("n1"))[3]).toBe("No reading");
    unmount();

    core.listNodes.mockResolvedValue({ error: "nodes is forbidden" });
    open();
    await waitFor(() => expect(screen.getByText(/nodes is forbidden/)).toBeTruthy());
    // One refused list is one empty section: the namespace count is untouched.
    expect(value("Namespaces")).toBe("4");
  });
});

describe("Overview — the node actions", () => {
  it("does not drain a node until the drain is confirmed", async () => {
    open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());

    await userEvent.click(within(rowFor("n1")).getByRole("button", { name: "Drain" }));
    expect(core.drainNode).not.toHaveBeenCalled();

    const box = dialog();
    expect(box).toBeTruthy();
    // The confirm says what will happen, and shows the kubectl it stands for.
    expect(within(box!).getByText(/evicts every pod/i)).toBeTruthy();
    expect(
      within(box!).getByText(
        "kubectl drain n1 --ignore-daemonsets --delete-emptydir-data --force --context prod-eu",
      ),
    ).toBeTruthy();

    await userEvent.click(within(box!).getByRole("button", { name: "Drain" }));
    await waitFor(() => expect(core.drainNode).toHaveBeenCalledWith("prod-eu", "n1"));
    expect(core.drainNode).toHaveBeenCalledTimes(1);
  });

  it("cordons behind a confirm, and offers to uncordon a node already cordoned", async () => {
    core.listNodes.mockResolvedValue({ nodes: [aNode("n1"), aNode("n2", { unschedulable: true })] });
    open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());

    await userEvent.click(within(rowFor("n1")).getByRole("button", { name: "Cordon" }));
    expect(core.cordonNode).not.toHaveBeenCalled();
    expect(within(dialog()!).getByText("kubectl cordon n1 --context prod-eu")).toBeTruthy();
    await userEvent.click(within(dialog()!).getByRole("button", { name: "Cordon" }));
    await waitFor(() => expect(core.cordonNode).toHaveBeenCalledWith("prod-eu", "n1", true));

    // The cordoned node is offered the other direction, not the same one again.
    expect(within(rowFor("n2")).queryByRole("button", { name: "Cordon" })).toBeNull();
    await userEvent.click(within(rowFor("n2")).getByRole("button", { name: "Uncordon" }));
    await userEvent.click(within(dialog()!).getByRole("button", { name: "Uncordon" }));
    await waitFor(() => expect(core.cordonNode).toHaveBeenCalledWith("prod-eu", "n2", false));
  });

  it("keeps the dialog open with the reason when a drain fails", async () => {
    core.drainNode.mockResolvedValue({ error: "nodes/eviction is forbidden" });
    open();
    await waitFor(() => expect(rowFor("n1")).toBeTruthy());

    await userEvent.click(within(rowFor("n1")).getByRole("button", { name: "Drain" }));
    await userEvent.click(within(dialog()!).getByRole("button", { name: "Drain" }));

    await waitFor(() => expect(within(dialog()!).getByText(/nodes\/eviction is forbidden/)).toBeTruthy());
    // Still open, so nothing reads as having succeeded.
    expect(dialog()).toBeTruthy();
  });
});
