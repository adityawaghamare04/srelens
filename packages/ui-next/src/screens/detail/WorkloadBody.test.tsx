import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { K8sObject, PodSummary, PodMetric, ReplicaSetSummary } from "@srelens/core";

// `WorkloadDetailsBody`'s "Pods" section reads live pods/metrics for the
// workload's selector, and a Deployment's "Deploy Revisions" section reads
// its rolled-out ReplicaSets, via core's `podsForSelector`/`podMetrics`/
// `listReplicaSets` — mocked here so a test controls what "the cluster
// said" without one. `importOriginal` keeps every reader
// (`updateStrategy`, `str`, `asRecord`, ...) intact.
const { podsForSelector, podMetrics, listReplicaSets } = vi.hoisted(() => ({
  podsForSelector: vi.fn(async (): Promise<{ pods?: PodSummary[]; error?: string }> => ({ pods: [] })),
  podMetrics: vi.fn(async (): Promise<{ metrics?: PodMetric[]; error?: string }> => ({ metrics: [] })),
  listReplicaSets: vi.fn(async (): Promise<{ replicasets?: ReplicaSetSummary[]; error?: string }> => ({
    replicasets: [],
  })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  podsForSelector,
  podMetrics,
  listReplicaSets,
}));

import { formatCpu, formatMemory } from "../../lib/kinds/columns";
import { GenericBody } from "./GenericBody";
import { WorkloadDetailsBody as Body } from "./WorkloadBody";

/**
 * The body under test, with the ROUTE's kind supplied the way `ResourceDetail`
 * supplies it. Defaulted from the fixture's own `kind` so the cases below read
 * as they did — that is plumbing for this file, not the `str(object.kind)`
 * re-derivation the body itself carried until the whole-branch review. One
 * case below passes a kind the object contradicts, which is what proves the
 * prop is the thing being read.
 */
function WorkloadDetailsBody({
  kind,
  object,
  context,
}: {
  kind?: string;
  object: K8sObject;
  context: string;
}) {
  return <Body kind={kind ?? String(object.kind ?? "")} object={object} context={context} />;
}

function workload(
  kind: string,
  spec: Record<string, unknown>,
  status: Record<string, unknown> = {},
  metadata: NonNullable<K8sObject["metadata"]> = { name: "web", namespace: "default" },
): K8sObject {
  return { kind, apiVersion: "apps/v1", metadata, spec, status } as K8sObject;
}

const POD_A: PodSummary = {
  name: "web-abc-1",
  namespace: "default",
  phase: "Running",
  ready: "1/1",
  restarts: 0,
  node: "node-a",
  age: "2d",
  image: "app:1.0",
};

/** The label column of one flat block, in the order it reads. `heading`
 *  names the block; without one, the pane's first block — which the design
 *  heads with nothing at all. */
function factLabels(container: HTMLElement, heading?: string): string[] {
  const block = heading
    ? screen.getByRole("heading", { name: heading }).closest("section")
    : container.querySelector("section.section");
  return [...(block?.querySelectorAll(".kv-k") ?? [])].map((el) => el.textContent ?? "");
}

/** The design's own frame A: a Deployment mid-rollout, 9 of 12 ready. */
const CHECKOUT_API: K8sObject = {
  kind: "Deployment",
  apiVersion: "apps/v1",
  metadata: {
    name: "checkout-api",
    namespace: "checkout",
    creationTimestamp: "2026-05-30T00:00:00Z",
    labels: { "app.kubernetes.io/name": "checkout-api" },
    annotations: { "deployment.kubernetes.io/revision": "119" },
  },
  spec: {
    replicas: 12,
    minReadySeconds: 10,
    selector: { matchLabels: { "app.kubernetes.io/name": "checkout-api" } },
    strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: "25%", maxUnavailable: 0 } },
    template: { spec: { containers: [{ name: "api", image: "acme/checkout-api:4f2a1c" }] } },
  },
  status: {
    replicas: 12,
    readyReplicas: 9,
    updatedReplicas: 9,
    availableReplicas: 9,
    unavailableReplicas: 3,
    conditions: [
      { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" },
      { type: "Progressing", status: "True", reason: "ReplicaSetUpdated" },
    ],
  },
} as K8sObject;

const REVISION_119: ReplicaSetSummary = {
  name: "checkout-api-7d9f",
  revision: "119",
  desired: 12,
  ready: 9,
  current: 12,
  age: "6m",
};

describe("WorkloadDetailsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    podsForSelector.mockResolvedValue({ pods: [] });
    podMetrics.mockResolvedValue({ metrics: [] });
    listReplicaSets.mockResolvedValue({ replicasets: [] });
  });

  describe("the fact list (Deployment/StatefulSet/ReplicaSet)", () => {
    it("reads the facts the design's own Deployment frame reads, in its order, unheaded", async () => {
      listReplicaSets.mockResolvedValue({ replicasets: [REVISION_119] });
      const { container } = render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      await waitFor(() => expect(screen.getByText("119 (6m ago)")).toBeDefined());
      expect(factLabels(container)).toEqual([
        "Replicas",
        "Up to date",
        "Strategy",
        "Revision",
        "Selector",
        "Min ready seconds",
        "Namespace",
        "Created",
        "Image",
      ]);
      expect(screen.queryByRole("heading", { name: "Properties" })).toBeNull();
    });

    it("counts replicas the way the design does — ready against desired", async () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(screen.getByText("9 ready · 12 desired")).toBeDefined();
      // Not classic's five-number sentence.
      expect(screen.queryByText(/desired,/)).toBeNull();
      await waitFor(() => expect(listReplicaSets).toHaveBeenCalled());
    });

    it("gives Up to date a row of its own instead of folding it into Replicas", () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(screen.getByText("Up to date")).toBeDefined();
      expect(screen.getByText("9 of 12")).toBeDefined();
    });

    it("shows a Deployment's whole strategy, surge and unavailable included", () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      // This file's own `updateStrategyText`, over core's `updateStrategy`
      // facts, which the Deployment branch used to skip — so a Deployment
      // showed the bare type, with the two numbers that decide how a rollout
      // behaves dropped. The form is this design's; classic words the same
      // facts its own way, and neither reaches the other.
      expect(screen.getByText("RollingUpdate · surge 25% · unavailable 0")).toBeDefined();
      expect(screen.getByText("Strategy")).toBeDefined();
      expect(screen.queryByText("Strategy type")).toBeNull();
    });

    it("still shows the strategy for a StatefulSet, off its own updateStrategy", () => {
      render(
        <WorkloadDetailsBody
          object={workload("StatefulSet", {
            replicas: 1,
            selector: { matchLabels: {} },
            updateStrategy: { type: "RollingUpdate", rollingUpdate: { partition: 2 } },
          })}
          context="ctx"
        />,
      );
      expect(screen.getByText("RollingUpdate · partition 2")).toBeDefined();
    });

    it("names the revision, aged by the ReplicaSet that carries it", async () => {
      listReplicaSets.mockResolvedValue({ replicasets: [REVISION_119] });
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      await waitFor(() => expect(screen.getByText("119 (6m ago)")).toBeDefined());
      // One fetch feeds both the fact and the revisions table below it.
      expect(listReplicaSets).toHaveBeenCalledTimes(1);
      expect(listReplicaSets).toHaveBeenCalledWith("ctx", "checkout", "checkout-api");
    });

    it("shows the revision number alone until its ReplicaSet is known", () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      // Scoped to the fact row: "119" is also the annotation's own value in
      // the Annotations block below.
      expect(screen.getByText("Revision").closest("dl")?.textContent).toBe("Revision119");
    });

    it("omits Revision for a workload that records none", () => {
      const { container } = render(
        <WorkloadDetailsBody
          object={workload("StatefulSet", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(factLabels(container)).not.toContain("Revision");
    });

    it("shows minReadySeconds, which nothing read before", () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(screen.getByText("Min ready seconds")).toBeDefined();
      expect(screen.getByText("10")).toBeDefined();
    });

    it("shows the pod template's image", () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(screen.getByText("Image")).toBeDefined();
      expect(screen.getByText("acme/checkout-api:4f2a1c")).toBeDefined();
    });

    it("names every image a multi-container template runs", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", {
            replicas: 1,
            selector: { matchLabels: {} },
            template: { spec: { containers: [{ image: "app:1" }, { image: "sidecar:2" }] } },
          })}
          context="ctx"
        />,
      );
      expect(screen.getByText("app:1")).toBeDefined();
      expect(screen.getByText("sidecar:2")).toBeDefined();
    });

    it("drops the Name row, which repeated the pane's own header", () => {
      const { container } = render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(factLabels(container)).not.toContain("Name");
      // The name appears nowhere as a fact VALUE either — it is still the
      // value of the workload's own label and selector, which is not a
      // repetition of the header.
      const values = [...container.querySelectorAll(".kv-v")].map((el) => el.textContent);
      expect(values).not.toContain("checkout-api");
    });

    it("reads Created as an age alone", () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      const created = screen.getByText("Created").closest("dl");
      expect(created?.textContent).toMatch(/^Created\d/);
      expect(created?.textContent).not.toMatch(/\(/);
    });

    it("shows the selector and the owner, as inert text", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "ReplicaSet",
            { replicas: 1, selector: { matchLabels: { app: "web", tier: "frontend" } } },
            {},
            { name: "web-abc123", namespace: "default", ownerReferences: [{ kind: "Deployment", name: "web" }] },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("app=")).toBeDefined();
      expect(screen.getByText("tier=")).toBeDefined();
      expect(screen.getByText("Managed by")).toBeDefined();
      expect(screen.getByText("Deployment/web")).toBeDefined();
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits the selector row for a workload with no selector, and fetches no related pods", async () => {
      const { container } = render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(factLabels(container)).not.toContain("Selector");
      expect(screen.queryByText("Pods")).toBeNull();
      await Promise.resolve();
      expect(podsForSelector).not.toHaveBeenCalled();
    });

    it("omits Managed by when the workload has no owner", () => {
      const { container } = render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(factLabels(container)).not.toContain("Managed by");
    });

    it("shows a StatefulSet's Service and volume claim templates", () => {
      render(
        <WorkloadDetailsBody
          object={workload("StatefulSet", {
            replicas: 1,
            selector: { matchLabels: {} },
            serviceName: "web-headless",
            volumeClaimTemplates: [{ metadata: { name: "data" } }, { metadata: { name: "cache" } }],
          })}
          context="ctx"
        />,
      );
      expect(screen.getByText("web-headless")).toBeDefined();
      expect(screen.getByText("data, cache")).toBeDefined();
    });

    it("omits Service and volume claim templates for a Deployment/ReplicaSet", () => {
      const { container } = render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(factLabels(container)).not.toContain("Service");
      expect(factLabels(container)).not.toContain("Volume claim templates");
    });

    it("is a flat run of blocks, not a stack of cards", () => {
      const { container } = render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(container.querySelector(".card")).toBeNull();
      expect(container.querySelectorAll("section.section").length).toBeGreaterThan(1);
    });
  });

  describe("the health it does not restate", () => {
    it("states no status word of its own — the header says it, once", () => {
      // The panel used to derive a second verdict here, from
      // `availableReplicas >= desired`. The design's Deployment frame has no
      // such row, and the header states the word through core's
      // `resourceStatusLine`, so the second reading is gone rather than
      // re-pointed.
      const { container } = render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(factLabels(container)).not.toContain("Status");
      // Scoped to the fact list: the Conditions block below it is pills all
      // the way down, and those are conditions, not the workload's health.
      expect(container.querySelector("section.section")?.querySelector(".status")).toBeNull();
      expect(screen.queryByText("Pending")).toBeNull();
      expect(screen.queryByText("Degraded")).toBeNull();
    });

    it("counts ready replicas, not available ones, so the header cannot contradict it", () => {
      // Available is the subset of ready replicas that have outlived
      // `minReadySeconds`, so a Deployment with one set sits at ready >
      // available for a while. The header and the list row both read
      // `readyReplicas`; the numbers here read the same field.
      render(
        <WorkloadDetailsBody
          object={workload(
            "Deployment",
            { replicas: 12, minReadySeconds: 10, selector: { matchLabels: {} } },
            { replicas: 12, readyReplicas: 12, availableReplicas: 9, updatedReplicas: 12 },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("12 ready · 12 desired")).toBeDefined();
      expect(screen.queryByText(/9 ready/)).toBeNull();
    });

    it("reads zero for a workload whose status reports no counts at all", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 0, selector: { matchLabels: {} } }, {})}
          context="ctx"
        />,
      );
      expect(screen.getByText("0 ready · 0 desired")).toBeDefined();
    });
  });

  describe("Conditions, and what the body no longer draws", () => {
    it("shows each condition's status and reason, not a bare pill", () => {
      const { container } = render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(factLabels(container, "Conditions")).toEqual(["Available", "Progressing"]);
      expect(screen.getByText("False · MinimumReplicasUnavailable")).toBeDefined();
      expect(screen.getByText("True · ReplicaSetUpdated")).toBeDefined();
    });

    it("omits the Conditions block when the workload reports none", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Conditions")).toBeNull();
    });

    // Labels and Annotations are no longer this body's — the host places them,
    // so the peek can stack them and the full tab can read them side by side.
    // Pinned on the pane instead: `ResourceDetail.test`'s "Labels and
    // Annotations, which the host places".
    it("renders neither Labels nor Annotations, leaving both to the host", () => {
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      expect(screen.queryByRole("heading", { name: "Labels" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Annotations" })).toBeNull();
    });

  });

  describe("related pods", () => {
    it("fetches and shows the related pods matched by the selector", async () => {
      podsForSelector.mockResolvedValue({ pods: [POD_A] });
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: { app: "web" } } })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("web-abc-1")).toBeDefined());
      expect(podsForSelector).toHaveBeenCalledWith("ctx", "default", { app: "web" });
      expect(screen.getAllByText("node-a").length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("reads a crash-looping pod's waiting reason in the table, not the phase that hides it", async () => {
      // The row's own phase is still "Running" — a pod in a back-off loop
      // reports that — so a Status column reading `phaseKind(p.phase)` drew a
      // crash-looping pod green, in a table the reader had opened because the
      // Deployment above it was degraded. The shared section reads
      // `podStatus`, the same function the list row and the pane's header do.
      podsForSelector.mockResolvedValue({
        pods: [{ ...POD_A, ready: "0/1", restarts: 7, waitingReason: "CrashLoopBackOff" }],
      });
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: { app: "web" } } })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("CrashLoopBackOff")).toBeDefined());
      expect(screen.queryByText("Running")).toBeNull();
    });

    it("formats CPU and memory the way the list and the Workloads table do, not a second way", async () => {
      // One pod read "2 410m" / "3.1 Gi" in the list and "2.410" / "3174 Mi"
      // in this very table, two panes apart, because this column set did its
      // own arithmetic instead of calling `formatCpu`/`formatMemory`. The
      // expected strings are taken from those two functions rather than
      // written out, so the pin cannot drift from them either. (#331)
      podsForSelector.mockResolvedValue({ pods: [POD_A] });
      podMetrics.mockResolvedValue({
        metrics: [{ name: "web-abc-1", namespace: "default", cpuMillicores: 2410, memoryMiB: 3174 }],
      });
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: { app: "web" } } })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("web-abc-1")).toBeDefined());
      // Read off the cells rather than through `getByText`: `formatCpu`
      // groups thousands with a thin space (U+2009), which the query's own
      // whitespace normalizer would collapse on one side of the comparison
      // and not the other.
      const cells = [...screen.getByText("web-abc-1").closest("tr")!.querySelectorAll("td")].map(
        (td) => td.textContent,
      );
      expect(cells).toContain(formatCpu(2410));
      expect(cells).toContain(formatMemory(3174));
      // The two forms this replaced, named so a revert is caught by its own
      // output rather than only by the absence of the right one.
      expect(cells).not.toContain("2.410");
      expect(cells).not.toContain("3174 Mi");
    });

    it("shows No pods when the selector matches nothing", async () => {
      podsForSelector.mockResolvedValue({ pods: [] });
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 3, selector: { matchLabels: { app: "web" } } })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("No pods")).toBeDefined());
    });

    it("keeps every block a section while the pods load, so the rules stay drawn", () => {
      // A bare `LoadingState` between two sections breaks the
      // `.section + .section` chain and leaves both gaps unruled.
      const { container } = render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: { app: "web" } } })}
          context="ctx"
        />,
      );
      expect(screen.getByText("Loading pods")).toBeDefined();
      expect([...container.children].every((el) => el.classList.contains("section"))).toBe(true);
    });
  });

  describe("Deploy Revisions (Deployment)", () => {
    const REVISION_1: ReplicaSetSummary = {
      name: "web-abc123",
      revision: "1",
      desired: 0,
      ready: 0,
      current: 0,
      age: "2d",
    };

    it("shows each revision's number, name, pod count and age", async () => {
      listReplicaSets.mockResolvedValue({ replicasets: [REVISION_119, REVISION_1] });
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      // Settles on a ROW, not on the section heading: `DeployRevisionsSection`
      // draws that heading over its `LoadingState` too, so a `waitFor` on it
      // returns before `listReplicaSets` has answered and the six reads below
      // race the fetch. It failed the full-suite gate once, under the load of
      // 195 files in parallel, and passed on its own every time — the same
      // loading-frame signal that made the two-hosts test flaky. (#331)
      await waitFor(() => expect(screen.getByText("checkout-api-7d9f")).toBeDefined());
      expect(screen.getByRole("heading", { name: "Deploy Revisions" })).toBeDefined();
      expect(screen.getByText("9/12")).toBeDefined();
      expect(screen.getByText("6m")).toBeDefined();
      expect(screen.getByText("web-abc123")).toBeDefined();
      expect(screen.getByText("0/0")).toBeDefined();
      expect(screen.getByText("2d")).toBeDefined();
    });

    it("shows No revisions when the Deployment has none yet", async () => {
      listReplicaSets.mockResolvedValue({ replicasets: [] });
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      await waitFor(() => expect(screen.getByText("No revisions")).toBeDefined());
    });

    it.each(["StatefulSet", "DaemonSet", "ReplicaSet"])("does not fetch revisions for a %s", async (kind) => {
      render(
        <WorkloadDetailsBody
          object={workload(kind, { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      await Promise.resolve();
      expect(listReplicaSets).not.toHaveBeenCalled();
      expect(screen.queryByText("Deploy Revisions")).toBeNull();
    });

    it("renders the revision's name inert, with no navigation control", async () => {
      listReplicaSets.mockResolvedValue({ replicasets: [REVISION_1] });
      render(<WorkloadDetailsBody object={CHECKOUT_API} context="ctx" />);
      await waitFor(() => expect(screen.getByText("web-abc123")).toBeDefined());
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });
  });

  describe("Scheduling (DaemonSet)", () => {
    it("shows the DaemonSet's per-node numbers, distinct from replica counts", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "DaemonSet",
            { selector: { matchLabels: { app: "logging" } } },
            {
              desiredNumberScheduled: 5,
              currentNumberScheduled: 4,
              numberReady: 3,
              updatedNumberScheduled: 2,
              numberAvailable: 1,
            },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("Desired")).toBeDefined();
      expect(screen.getByText("5")).toBeDefined();
      expect(screen.getByText("Ready")).toBeDefined();
      expect(screen.getByText("3")).toBeDefined();
      expect(screen.getByText("Up-to-date")).toBeDefined();
      expect(screen.getByText("2")).toBeDefined();
      expect(screen.queryByText(/desired,/)).toBeNull();
    });

    it("shows the update strategy in this design's form, off core's facts", () => {
      render(
        <WorkloadDetailsBody
          object={workload("DaemonSet", {
            selector: { matchLabels: { app: "logging" } },
            updateStrategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1 } },
          })}
          context="ctx"
        />,
      );
      expect(screen.getByText("RollingUpdate · unavailable 1")).toBeDefined();
    });

    it("shows the selector", () => {
      render(
        <WorkloadDetailsBody
          object={workload("DaemonSet", { selector: { matchLabels: { app: "logging" } } })}
          context="ctx"
        />,
      );
      expect(screen.getByText("app=")).toBeDefined();
      expect(screen.getByText("logging")).toBeDefined();
    });

    it("leaves a DaemonSet's conditions, labels and annotations to GenericBody", () => {
      // DaemonSet is not self-describing: `GenericBody` wraps it and supplies
      // those three blocks, so rendering them here too would show each twice.
      render(
        <WorkloadDetailsBody
          object={workload(
            "DaemonSet",
            { selector: { matchLabels: { app: "logging" } } },
            { conditions: [{ type: "Available", status: "True" }] },
            { name: "logger", namespace: "kube-system", labels: { app: "logging" }, annotations: { note: "ci" } },
          )}
          context="ctx"
        />,
      );
      expect(screen.queryByRole("heading", { name: "Conditions" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Labels" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Annotations" })).toBeNull();
    });

    it("omits the selector row and fetches no related pods for a DaemonSet with no selector", async () => {
      const { container } = render(<WorkloadDetailsBody object={workload("DaemonSet", {})} context="ctx" />);
      expect(factLabels(container, "Scheduling")).not.toContain("Selector");
      expect(screen.queryByText("Pods")).toBeNull();
      await Promise.resolve();
      expect(podsForSelector).not.toHaveBeenCalled();
    });

    it("does not fetch or render related pods for a DaemonSet on its own — GenericBody supplies them", async () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "DaemonSet",
            { selector: { matchLabels: { app: "logging" } } },
            {},
            { name: "logger", namespace: "kube-system" },
          )}
          context="ctx"
        />,
      );
      await Promise.resolve();
      expect(podsForSelector).not.toHaveBeenCalled();
      expect(screen.queryByText("Pods")).toBeNull();
    });

    it("renders exactly one related-pods section for a DaemonSet reached through GenericBody", async () => {
      podsForSelector.mockResolvedValue({ pods: [POD_A] });
      const daemonSet = workload(
        "DaemonSet",
        { selector: { matchLabels: { app: "logging" } } },
        {},
        { name: "logger", namespace: "kube-system" },
      );
      render(
        <GenericBody kind="DaemonSet" object={daemonSet} context="ctx">
          <WorkloadDetailsBody object={daemonSet} context="ctx" />
        </GenericBody>,
      );
      await waitFor(() => expect(screen.getByText("web-abc-1")).toBeDefined());
      // Asserting the COUNT, not merely presence — two "Pods" panels (one
      // from WorkloadDetailsBody, one from GenericBody) would also satisfy
      // a bare `getByText`.
      expect(screen.getAllByRole("heading", { name: "Pods" })).toHaveLength(1);
      expect(podsForSelector).toHaveBeenCalledTimes(1);
      expect(podsForSelector).toHaveBeenCalledWith("ctx", "kube-system", { app: "logging" });
    });
  });

  /**
   * The kind is the route's, and the body takes it as a prop rather than
   * re-deriving it from `object.kind`. Two sources of truth for one fact
   * agreed only because the API server happens to return `kind` on a
   * single-object GET — nothing structural made them agree. (#331)
   */
  describe("the kind it draws is the one it was handed", () => {
    it("draws a DaemonSet's per-node Scheduling block when told DaemonSet, whatever the payload says", () => {
      // The payload says Deployment; the route says DaemonSet. Only one of
      // the two can be what the body reads, and this pins which.
      render(
        <WorkloadDetailsBody
          kind="DaemonSet"
          object={workload("Deployment", { selector: { matchLabels: { app: "logging" } } }, { desiredNumberScheduled: 4, numberReady: 4 })}
          context="ctx"
        />,
      );
      expect(screen.getByRole("heading", { name: "Scheduling" })).toBeDefined();
      expect(screen.getByText("Desired")).toBeDefined();
      // The replica facts block is the pane's unheaded first section; its
      // "Replicas" row is what says it was drawn.
      expect(screen.queryByText("Replicas")).toBeNull();
    });

    it("draws the replica Properties block when told Deployment, whatever the payload says", () => {
      render(
        <WorkloadDetailsBody
          kind="Deployment"
          object={workload("DaemonSet", { replicas: 3, selector: { matchLabels: { app: "web" } } }, { readyReplicas: 3 })}
          context="ctx"
        />,
      );
      expect(screen.getByText("Replicas")).toBeDefined();
      expect(screen.queryByRole("heading", { name: "Scheduling" })).toBeNull();
    });

    it("draws a complete run of sections for an object carrying no kind of its own", async () => {
      // The `if (!kind)` guard this replaced returned a bare `EmptyState`
      // into the run, which is not a `.section` and so silently cost the
      // hairline rule on both sides of it. With the kind coming from the
      // dispatch key it cannot be empty — `DETAILS_BODY[""]` is undefined —
      // and the object's own missing `kind` changes nothing.
      const { container } = render(
        <WorkloadDetailsBody
          kind="Deployment"
          object={{ apiVersion: "apps/v1", metadata: { name: "web", namespace: "default" }, spec: { replicas: 1 }, status: {} } as K8sObject}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("Replicas")).toBeDefined());
      expect(screen.queryByText("No workload data")).toBeNull();
      expect([...container.children].every((el) => el.matches("section.section"))).toBe(true);
    });
  });
});
