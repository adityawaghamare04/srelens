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
  listDeployments: vi.fn(),
  listStatefulSets: vi.fn(),
  listDaemonSets: vi.fn(),
  clusterFacts: vi.fn(),
  podCount: vi.fn(),
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
  type DaemonSetSummary,
  type DeploymentSummary,
  type K8sObject,
  type NodeSummary,
  type PodSummary,
  type StatefulSetSummary,
} from "@srelens/core";
import { Overview } from "./Overview";
import { ConsoleProvider } from "../console";
import { defaultState } from "../lib/tabs";
import * as store from "../lib/tabsStore";
import { resetContexts, setContexts, setKubeconfigFiles } from "../lib/clusters";
import { probeCluster, resetProbes } from "../lib/probe";
import { resetView, setLink, type LinkState } from "../lib/workspace";

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
    instanceType: "",
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

function aDeployment(name: string, ready: string, namespace = "checkout"): DeploymentSummary {
  return { name, namespace, ready, upToDate: 1, available: 1, age: "8d" };
}

function aStatefulSet(name: string, ready: string, namespace = "payments"): StatefulSetSummary {
  return { name, namespace, ready, updated: 1, service: "svc", age: "8d" };
}

function aDaemonSet(name: string, ready: number, desired: number, namespace = "kube-system"): DaemonSetSummary {
  return {
    name,
    namespace,
    desired,
    current: ready,
    ready,
    upToDate: ready,
    available: ready,
    age: "40d",
  };
}

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
  core.listDeployments.mockResolvedValue({ deployments: [] });
  core.listStatefulSets.mockResolvedValue({ statefulsets: [] });
  core.listDaemonSets.mockResolvedValue({ daemonsets: [] });
  core.clusterFacts.mockResolvedValue(NO_FACTS);
  core.podCount.mockResolvedValue({ counts: { running: 4, total: 4 } });
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
  // The rail reads both: the probe for the server version, the workspace view
  // for the link. Neither survives a test.
  resetProbes();
  resetView();
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

  it("reads Pool from the node's own machine type", async () => {
    core.listNodes.mockResolvedValue({
      nodes: [aNode("eu-w4-c3-standard-a1", { instanceType: "c3-standard-8" })],
    });
    open();
    await waitFor(() => expect(rowFor("eu-w4-c3-standard-a1")).toBeTruthy());

    expect(cells(rowFor("eu-w4-c3-standard-a1"))[1]).toBe("c3-standard-8");
  });

  it("shows nothing in Pool rather than guessing one", async () => {
    // The node carries neither instance-type label — kind's nodes are
    // containers, not cloud machines — so it named no pool at all.
    core.listNodes.mockResolvedValue({
      nodes: [aNode("eu-w4-c3-standard-a1", { roles: "worker", instanceType: "" })],
    });
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

/* --------------------------------------------------------------- not ready */

/**
 * A cluster in several kinds of trouble at once.
 *
 * Deliberately not one shape of failure repeated: a fixture where every
 * unhealthy row is a Degraded workload cannot tell a right table of status
 * words from a wrong one, because both agree on the only case in it. This one
 * spans all three severities core can flag (danger, warning and the neutral
 * "we do not recognise this state"), four kinds, and — for each kind — one
 * subject core calls healthy or at rest, which must NOT appear.
 */
const SICK_DEPLOYMENTS: DeploymentSummary[] = [
  // 9 of 12 ready: core says Degraded, danger, flagged.
  aDeployment("zz-checkout-api", "9/12"),
  // Scaled to zero: neutral and NOT flagged. Amber-adjacent states like this
  // are why `flagged` is data rather than a reading of the tone.
  aDeployment("idle-batch", "0/0"),
];
const SICK_STATEFULSETS: StatefulSetSummary[] = [
  aStatefulSet("mm-payments-db", "1/3"),
  aStatefulSet("ok-cache", "3/3"),
];
const SICK_DAEMONSETS: DaemonSetSummary[] = [
  aDaemonSet("cc-log-agent", 2, 4),
  // Matches no node: "Not scheduled", and doing exactly what it was asked.
  aDaemonSet("nn-gpu-agent", 0, 0),
];
const SICK_PODS: PodSummary[] = [
  aPod("aa-worker-0", "n1", { namespace: "checkout", ready: "0/1", waitingReason: "CrashLoopBackOff" }),
  aPod("bb-queue-0", "n2", { namespace: "payments", phase: "Pending", ready: "0/1" }),
  // A phase core's table does not know: neutral, and still flagged — not
  // recognising a state is not the same as knowing it is fine.
  aPod("dd-mystery-0", "n3", { namespace: "search", phase: "Terminating", ready: "0/1" }),
  aPod("ok-web-0", "n1", { namespace: "checkout" }),
  aPod("done-backup-0", "n2", { namespace: "ops", phase: "Succeeded", ready: "0/1" }),
];

function sick() {
  core.listDeployments.mockResolvedValue({ deployments: SICK_DEPLOYMENTS });
  core.listStatefulSets.mockResolvedValue({ statefulsets: SICK_STATEFULSETS });
  core.listDaemonSets.mockResolvedValue({ daemonsets: SICK_DAEMONSETS });
  core.listPods.mockResolvedValue({ pods: SICK_PODS });
}

function notReady(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Not ready" });
  const card = heading.closest("section");
  if (!card) throw new Error("no Not ready section on screen");
  return card as HTMLElement;
}

const notReadyNames = () =>
  Array.from(notReady().querySelectorAll(".status-row-name")).map((el) => el.textContent ?? "");

const notReadyRow = (name: string) =>
  Array.from(notReady().querySelectorAll<HTMLElement>(".status-row")).find(
    (row) => row.querySelector(".status-row-name")?.textContent === name,
  );

const factsOf = (row: HTMLElement) =>
  Array.from(row.querySelectorAll(".status-row-fact")).map((el) => el.textContent ?? "");

/** The same subject as a fetched object, read by the function a detail pane reads. */
const asObject = (kind: string, spec: unknown, status: unknown): K8sObject =>
  ({ apiVersion: "v1", kind, metadata: { name: "x" }, spec, status }) as unknown as K8sObject;

describe("Overview — the not-ready list", () => {
  it("puts the worst thing first, whatever kind it happens to be", async () => {
    sick();
    open();
    await waitFor(() => expect(notReadyNames()).toHaveLength(6));

    // Danger first (alphabetically within the band, so the order is stable
    // across three lists that settle in whatever order they settle), then the
    // warning, then the state core could not read.
    expect(notReadyNames()).toEqual([
      "aa-worker-0",
      "cc-log-agent",
      "mm-payments-db",
      "zz-checkout-api",
      "bb-queue-0",
      "dd-mystery-0",
    ]);

    // And the point of the section: this is NOT the order a list grouped by
    // kind would produce. A Pod leads three workloads, and two more Pods
    // follow them.
    expect(notReadyNames()).not.toEqual([
      "zz-checkout-api",
      "mm-payments-db",
      "cc-log-agent",
      "aa-worker-0",
      "bb-queue-0",
      "dd-mystery-0",
    ]);
  });

  it("lists what core calls unhealthy, and nothing else", async () => {
    sick();
    open();
    await waitFor(() => expect(notReadyNames()).toHaveLength(6));

    // Healthy, finished, scaled to zero, and matching no node: four subjects
    // core does not flag, in four different tones. A section that read
    // badness off the tone would pick up at least one of them.
    for (const quiet of ["idle-batch", "ok-cache", "nn-gpu-agent", "ok-web-0", "done-backup-0"]) {
      expect(notReadyRow(quiet)).toBeUndefined();
    }

    // The sharpest form of it: two subjects core gives the SAME tone, one
    // flagged and one not. `idle-batch` (scaled to zero) and `dd-mystery-0`
    // (a phase core does not recognise) are both neutral; only the second is
    // in the list, which no reading of the colour could have produced.
    expect(notReadyRow("dd-mystery-0")?.querySelector(".status")?.getAttribute("data-kind")).toBe(
      "neutral",
    );
  });

  it("takes every word and every tone from core, across all three severities", async () => {
    sick();
    open();
    await waitFor(() => expect(notReadyNames()).toHaveLength(6));

    const expected: [name: string, line: ReturnType<typeof resourceStatusLine>][] = [
      ["zz-checkout-api", resourceStatusLine("Deployment", asObject("Deployment", { replicas: 12 }, { readyReplicas: 9 }))],
      ["mm-payments-db", resourceStatusLine("StatefulSet", asObject("StatefulSet", { replicas: 3 }, { readyReplicas: 1 }))],
      ["cc-log-agent", resourceStatusLine("DaemonSet", asObject("DaemonSet", {}, { numberReady: 2, desiredNumberScheduled: 4 }))],
      [
        "aa-worker-0",
        resourceStatusLine(
          "Pod",
          asObject("Pod", {}, {
            phase: "Running",
            containerStatuses: [{ ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } }],
          }),
        ),
      ],
      ["bb-queue-0", resourceStatusLine("Pod", asObject("Pod", {}, { phase: "Pending" }))],
      ["dd-mystery-0", resourceStatusLine("Pod", asObject("Pod", {}, { phase: "Terminating" }))],
    ];

    // Three distinct tones among them, so a single wrong tone cannot pass by
    // agreeing with the one case the fixture happens to contain.
    expect(new Set(expected.map(([, line]) => line!.health))).toEqual(
      new Set(["danger", "warning", "neutral"]),
    );

    for (const [name, line] of expected) {
      const row = notReadyRow(name);
      expect(row, `${name} should be in the not-ready list`).toBeTruthy();
      const pill = row!.querySelector(".status");
      expect(pill?.textContent, name).toBe(line!.status);
      expect(pill?.getAttribute("data-kind"), name).toBe(line!.health);
      // `flagged` is passed as data, not derived from the tone: every row
      // here is one core flagged, including the amber and the grey ones.
      expect(line!.flagged, name).toBe(true);
      // It reaches the pill as `tinted`. The kit colours the two tones the
      // design colours and leaves neutral plain — its own asymmetry, tested
      // in `StatusPill`; what matters here is that a flagged warning row is
      // coloured, which a caller passing `kind === "danger"` would have lost.
      if (line!.health !== "neutral") {
        expect(pill?.getAttribute("data-bad"), name).toBe("true");
      }
    }
  });

  it("names every trailing fact, so a reader hears more than 'checkout 9/12'", async () => {
    sick();
    open();
    await waitFor(() => expect(notReadyNames()).toHaveLength(6));

    // `StatusRow` takes `ReactNode`s and cannot know what a fact means; the
    // noun is the caller's job, and this is the assertion that keeps it done.
    for (const row of Array.from(notReady().querySelectorAll<HTMLElement>(".status-row"))) {
      const facts = factsOf(row);
      expect(facts).toHaveLength(2);
      for (const fact of facts) {
        expect(fact, `"${fact}" says nothing about what it is`).toMatch(/\b(namespace|ready)\b/);
      }
    }

    // And in the accessible name of the row itself, not merely somewhere in
    // the markup: the whole row is one button, and its name is its text.
    const row = within(notReady()).getByRole("button", { name: /zz-checkout-api/ });
    expect(row.textContent).toContain("Degraded");
    expect(row.textContent).toContain("namespace checkout");
    expect(row.textContent).toContain("9/12 ready");
    expect(within(notReady()).getByRole("button", { name: /bb-queue-0 namespace payments/ })).toBeTruthy();

    // The namespace comes before the ratio — the design's own column order.
    expect(factsOf(notReadyRow("cc-log-agent")!)).toEqual(["namespace kube-system", "2/4 ready"]);
  });

  it("opens the object's own detail when a row is activated", async () => {
    sick();
    open();
    await waitFor(() => expect(notReadyNames()).toHaveLength(6));

    await userEvent.click(within(notReady()).getByRole("button", { name: /zz-checkout-api/ }));
    expect(store.activeRoute()).toBe("/k/Deployment/checkout/zz-checkout-api");

    await userEvent.click(within(notReady()).getByRole("button", { name: /aa-worker-0/ }));
    expect(store.activeRoute()).toBe("/k/Pod/checkout/aa-worker-0");
  });

  it("says that nothing is unhealthy rather than leaving a blank", async () => {
    // The default fixture's one crash-looping pod, taken away.
    core.listPods.mockResolvedValue({ pods: PODS.filter((p) => !p.waitingReason) });
    open();
    await waitFor(() => expect(within(notReady()).getByText("Nothing is unhealthy")).toBeTruthy());

    expect(notReadyNames()).toEqual([]);
    expect(within(notReady()).getByText(/prod-eu/)).toBeTruthy();
  });

  it("does not read a refused list as a healthy cluster", async () => {
    core.listPods.mockResolvedValue({ pods: [] });
    core.listDeployments.mockResolvedValue({ error: 'deployments is forbidden: User "dev" cannot list' });
    open();

    await waitFor(() => expect(within(notReady()).getByText(/forbidden/)).toBeTruthy());
    // "Nothing is unhealthy" would be a claim nobody checked.
    expect(within(notReady()).queryByText("Nothing is unhealthy")).toBeNull();
  });

  it("keeps the rows it does have when one kind is refused, and says which", async () => {
    core.listPods.mockResolvedValue({ pods: SICK_PODS });
    core.listStatefulSets.mockResolvedValue({ error: 'statefulsets is forbidden: User "dev" cannot list' });
    open();

    await waitFor(() => expect(notReadyRow("aa-worker-0")).toBeTruthy());
    expect(notReadyNames()).toEqual(["aa-worker-0", "bb-queue-0", "dd-mystery-0"]);
    // The refusal is stated, not swallowed: the list is short for a reason.
    expect(within(notReady()).getByText(/statefulsets is forbidden/)).toBeTruthy();
    // And it stays one section's failure — the nodes table is untouched.
    expect(rowFor("n1")).toBeTruthy();
  });
});

/* --------------------------------------------------------------- the rail */

/** The `At a glance` rail, as the landmark its own head names. */
const rail = () => screen.getByRole("complementary", { name: "At a glance" });

/** One rail section, by the heading over it. */
function section(title: string): HTMLElement {
  const heading = within(rail()).getByRole("heading", { name: title });
  const found = heading.closest("section");
  if (!found) throw new Error(`no ${title} section in the rail`);
  return found as HTMLElement;
}

/** The control-plane facts as `label -> value`, in the order the rail draws them. */
function controlPlane(): Array<[string, string]> {
  return Array.from(section("Control plane").querySelectorAll(".kv")).map((kv) => [
    kv.querySelector(".kv-k")?.textContent ?? "",
    kv.querySelector(".kv-v")?.textContent ?? "",
  ]);
}

const factLabels = () => controlPlane().map(([k]) => k);
const factValue = (label: string) => controlPlane().find(([k]) => k === label)?.[1];

/** Seed the probe store the way the shell does, without a real connect call. */
async function probed(version: string | null) {
  await probeCluster(CTX, async () => ({ context: CTX.name, reachable: true, version }));
}

const SOME_FACTS: ClusterFacts = {
  context: "prod-eu",
  provider: "GKE",
  region: "europe-west4",
  metricsServer: { state: "present", version: "v1beta1" },
};

describe("Overview — the rail's control plane", () => {
  it("omits a fact the cluster did not report rather than calling it unknown", async () => {
    // The live case, not an edge one: no node on a kind cluster carries a
    // region label, and `clusterFacts` reports that as an empty string.
    core.clusterFacts.mockResolvedValue({ ...SOME_FACTS, provider: "", region: "" });
    open();
    await waitFor(() => expect(factValue("Context")).toBe("prod-eu"));

    expect(factLabels()).not.toContain("Provider");
    expect(factLabels()).not.toContain("Region");
    // And nothing standing in for them: "unknown" and an em dash both read as
    // answers, and the cluster gave none.
    expect(section("Control plane").textContent).not.toMatch(/unknown/i);
    expect(section("Control plane").textContent).not.toContain("—");
  });

  it("draws the facts the cluster did report, in the design's order", async () => {
    core.clusterFacts.mockResolvedValue(SOME_FACTS);
    await probed("v1.31.4");
    setLink(CTX.stableId, "connected");
    open();

    await waitFor(() => expect(factValue("Provider")).toBe("GKE"));
    expect(factLabels()).toEqual([
      "Version",
      "Provider",
      "Region",
      "Context",
      "Connection",
      "Metrics server",
    ]);
    expect(factValue("Version")).toBe("v1.31.4");
    expect(factValue("Region")).toBe("europe-west4");
  });

  it("takes the connection's word from the one table the status bar reads", async () => {
    // Four states, not one: a fixture with a single link state cannot tell a
    // right table from a wrong one. The words are `LINK_WORD`'s, shared with
    // the status bar, so the rail and the strip cannot disagree about the
    // same cluster.
    const cases: Array<[LinkState, string]> = [
      ["connected", "Connected"],
      ["connecting", "Connecting"],
      ["disconnected", "Disconnected"],
      ["error", "Unreachable"],
    ];
    for (const [state, word] of cases) {
      setLink(CTX.stableId, state);
      const { unmount } = open();
      await waitFor(() => expect(factValue("Connection")).toBe(word));
      unmount();
    }
  });

  it("says nothing about the connection until something has probed it", async () => {
    open();
    await waitFor(() => expect(factValue("Context")).toBe("prod-eu"));
    // No link state is not "Disconnected" — it is nobody having asked yet.
    expect(factLabels()).not.toContain("Connection");
    // Same for the version, which arrives with the probe.
    expect(factLabels()).not.toContain("Version");
  });

  it("reads the metrics server's API group version, not a component version", async () => {
    core.clusterFacts.mockResolvedValue(SOME_FACTS);
    open();

    await waitFor(() => expect(factValue("Metrics server")).toBe("v1beta1"));
    // The mock's `v0.7.2 · reporting` is two claims this screen cannot make:
    // the component version needs an RBAC-sensitive read of the deployment's
    // image, and an aggregated APIService stays in discovery while its backing
    // deployment is down — so "present" is not "answering".
    expect(section("Control plane").textContent).not.toContain("reporting");
    expect(section("Control plane").textContent).not.toContain("v0.7.2");
  });

  it("states a missing metrics server once, in the rail, and nowhere else", async () => {
    core.clusterFacts.mockResolvedValue({
      ...SOME_FACTS,
      metricsServer: { state: "absent", version: "" },
    });
    // The same cluster's metrics call fails too, which is what a missing
    // metrics-server does — every tile and column reads "No reading".
    core.nodeMetrics.mockResolvedValue({ error: "the server could not find the requested resource" });
    open();

    await waitFor(() => expect(factValue("Metrics server")).toContain("Not installed"));
    expect(value("CPU")).toBe("No reading");

    // Once. Five tiles and two columns each announcing it would have said it
    // seven times and explained it nowhere.
    expect(screen.getAllByText(/not installed/i)).toHaveLength(1);
  });

  it("does not call the metrics server absent when only the request failed", async () => {
    // Discovery says the group is there; the reading failed anyway — a
    // throttled apiserver, a transient refusal. Two different questions with
    // the same visible answer, and the rail must read the discovery one.
    core.clusterFacts.mockResolvedValue(SOME_FACTS);
    core.nodeMetrics.mockResolvedValue({ error: "the server is currently unable to handle the request" });
    open();

    await waitFor(() => expect(factValue("Metrics server")).toBe("v1beta1"));
    expect(screen.queryByText(/not installed/i)).toBeNull();
    // The tiles still say there is no reading — they just do not say why.
    expect(value("CPU")).toBe("No reading");
  });

  it("omits the metrics-server row when nobody could ask", async () => {
    // `unknown` is not `absent`: an unreachable cluster has not told us
    // metrics-server is missing, and drawing that as an absence would be the
    // rail inventing the one fact it exists to report.
    core.clusterFacts.mockResolvedValue({ ...SOME_FACTS, metricsServer: { state: "unknown", version: "" } });
    open();

    await waitFor(() => expect(factValue("Provider")).toBe("GKE"));
    expect(factLabels()).not.toContain("Metrics server");
  });
});

describe("Overview — the rail's object counts", () => {
  const countRow = (label: string) =>
    within(section("Objects by kind")).getByRole("button", { name: new RegExp(`^${label}`) });

  it("counts a kind off the list the screen already loaded, without asking twice", async () => {
    core.listDeployments.mockResolvedValue({
      deployments: [aDeployment("a", "1/1"), aDeployment("b", "1/1")],
    });
    core.listStatefulSets.mockResolvedValue({ statefulsets: [aStatefulSet("c", "1/1")] });
    core.listResource.mockResolvedValue({ items: [{ name: "x" }] });
    open();

    await waitFor(() => expect(countRow("Deployments").textContent).toContain("2"));
    expect(countRow("StatefulSets").textContent).toContain("1");
    // Four pods in the fixture, from the one `listPods` the screen makes.
    expect(countRow("Pods").textContent).toContain("4");

    // The collapse: Deployments, StatefulSets, DaemonSets and Pods are all
    // already on screen, so the generic list is called only for the two kinds
    // nothing else loads.
    expect(core.listDeployments).toHaveBeenCalledTimes(1);
    expect(core.listPods).toHaveBeenCalledTimes(1);
    expect(core.listResource).toHaveBeenCalledTimes(2);
    expect(core.listResource.mock.calls.map((c: unknown[]) => c[1])).toEqual(["CronJob", "Job"]);
  });

  it("opens that kind's list when a row is activated", async () => {
    open();
    await waitFor(() => expect(countRow("Deployments")).toBeTruthy());

    await userEvent.click(countRow("Deployments"));
    expect(store.activeRoute()).toBe("/k/deployments");

    await userEvent.click(countRow("CronJobs"));
    expect(store.activeRoute()).toBe("/k/cronjobs");
  });

  it("shows no number for a kind it could not count, and says why", async () => {
    core.listResource.mockImplementation((_context: string, kind: string) =>
      Promise.resolve(
        kind === "Job"
          ? { error: 'jobs is forbidden: User "dev" cannot list resource "jobs"' }
          : { items: [{ name: "x" }, { name: "y" }] },
      ),
    );
    open();

    await waitFor(() => expect(countRow("CronJobs").textContent).toContain("2"));
    // Zero is a number a reader will believe. A refusal is not a count.
    expect(countRow("Jobs").textContent).not.toContain("0");
    expect(countRow("Jobs").textContent).toContain("—");
    expect(section("Objects by kind").textContent).toContain("Jobs");
    expect(within(section("Objects by kind")).getByText(/could not count/i)).toBeTruthy();
  });

  it("does not count a refused workload list as a cluster with none of that kind", async () => {
    core.listDeployments.mockResolvedValue({ error: "deployments is forbidden" });
    open();

    await waitFor(() => expect(countRow("Pods").textContent).toContain("4"));
    expect(countRow("Deployments").textContent).not.toContain("0");
    expect(countRow("Deployments").textContent).toContain("—");
  });
});

describe("Overview — the rail's incidents and fleet", () => {
  it("names the incidents section rather than leaving a hole", async () => {
    open();
    const incidents = await waitFor(() => section("Open incidents"));

    // A silent absence reads as a bug. This one says what it is: no
    // Kubernetes API returns an incident's title, severity or trend, and
    // Incidents is scheduled as its own feature.
    expect(incidents.textContent).toMatch(/incident/i);
    expect(incidents.textContent).toMatch(/srelens/);
    expect(incidents.textContent).not.toMatch(/SEV-\d/);
  });

  it("counts this cluster's pods in the fleet, whatever else is in the workspace", async () => {
    core.podCount.mockResolvedValue({ counts: { running: 30, total: 33 } });
    open();

    const fleet = await waitFor(() => section("Fleet"));
    await waitFor(() => expect(fleet.textContent).toContain("30/33 running"));
    expect(within(fleet).getByText("prod-eu")).toBeTruthy();
    expect(core.podCount).toHaveBeenCalledWith("prod-eu");
  });

  it("keeps the rest of the screen when the fleet cannot answer", async () => {
    core.podCount.mockResolvedValue({ error: "pod count timed out" });
    open();

    await waitFor(() => expect(section("Fleet").textContent).toContain("Unreachable"));
    // Fleet is a courtesy; the overview is about this cluster.
    expect(value("Nodes")).toBe("3");
    expect(rowFor("n1")).toBeTruthy();
  });
});
