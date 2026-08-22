import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { K8sObject, PodSummary, PodMetric } from "@srelens/core";

// `WorkloadDetailsBody`'s "Pods" section reads live pods/metrics for the
// workload's selector, via core's `podsForSelector`/`podMetrics` — mocked
// here so a test controls what "the cluster said" without one.
// `importOriginal` keeps every formatter (`updateStrategyText`, `str`,
// `asRecord`, ...) intact.
const { podsForSelector, podMetrics } = vi.hoisted(() => ({
  podsForSelector: vi.fn(async (): Promise<{ pods?: PodSummary[]; error?: string }> => ({ pods: [] })),
  podMetrics: vi.fn(async (): Promise<{ metrics?: PodMetric[]; error?: string }> => ({ metrics: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  podsForSelector,
  podMetrics,
}));

import { WorkloadDetailsBody } from "./WorkloadBody";

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

describe("WorkloadDetailsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    podsForSelector.mockResolvedValue({ pods: [] });
    podMetrics.mockResolvedValue({ metrics: [] });
  });

  describe("Properties (Deployment/StatefulSet/ReplicaSet)", () => {
    it("shows the replica counts as one summary fact", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "Deployment",
            { replicas: 3, selector: { matchLabels: {} } },
            { replicas: 3, updatedReplicas: 2, availableReplicas: 2, unavailableReplicas: 1 },
          )}
          context="ctx"
        />,
      );
      expect(
        screen.getByText("3 desired, 2 updated, 3 total, 2 available, 1 unavailable"),
      ).toBeDefined();
    });

    it("shows a Deployment mid-rollout as Pending, not Running", () => {
      // 3 desired, only 2 available: srelens shows "Running" only once fully available.
      render(
        <WorkloadDetailsBody
          object={workload(
            "Deployment",
            { replicas: 3, selector: { matchLabels: {} } },
            { replicas: 3, updatedReplicas: 2, availableReplicas: 2, unavailableReplicas: 1 },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("Pending")).toBeDefined();
    });

    it("shows Running once the workload is fully available", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "Deployment",
            { replicas: 2, selector: { matchLabels: {} } },
            { replicas: 2, updatedReplicas: 2, availableReplicas: 2, unavailableReplicas: 0 },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("Running")).toBeDefined();
    });

    it("shows the strategy via core's updateStrategyText for a StatefulSet/ReplicaSet", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "StatefulSet",
            {
              replicas: 1,
              selector: { matchLabels: {} },
              updateStrategy: { type: "RollingUpdate", rollingUpdate: { partition: 2 } },
            },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("RollingUpdate (partition 2)")).toBeDefined();
    });

    it("shows a Deployment's strategy type straight from spec.strategy.type", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", {
            replicas: 1,
            selector: { matchLabels: {} },
            strategy: { type: "Recreate" },
          })}
          context="ctx"
        />,
      );
      expect(screen.getByText("Recreate")).toBeDefined();
    });

    it("shows the selector", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", {
            replicas: 1,
            selector: { matchLabels: { app: "web", tier: "frontend" } },
          })}
          context="ctx"
        />,
      );
      expect(screen.getByTitle("app=web")).toBeDefined();
      expect(screen.getByTitle("tier=frontend")).toBeDefined();
    });

    it("omits the selector row for a workload with no selector, and fetches no related pods", async () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Selector")).toBeNull();
      expect(screen.queryByText("Pods")).toBeNull();
      await Promise.resolve();
      expect(podsForSelector).not.toHaveBeenCalled();
    });

    it("shows Name, Namespace, Created, Labels and Annotations", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "Deployment",
            { replicas: 1, selector: { matchLabels: {} } },
            {},
            {
              name: "checkout-api",
              namespace: "default",
              creationTimestamp: "2026-08-20T00:00:00Z",
              labels: { app: "web" },
              annotations: { note: "ci" },
            },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("checkout-api")).toBeDefined();
      expect(screen.getByText("default")).toBeDefined();
      expect(screen.getByTitle("app=web")).toBeDefined();
      expect(screen.getByTitle("note=ci")).toBeDefined();
    });

    it("omits Labels and Annotations when absent", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Labels")).toBeNull();
      expect(screen.queryByText("Annotations")).toBeNull();
    });

    it("shows Managed By as inert Kind/name text for each owner reference", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "ReplicaSet",
            { replicas: 1, selector: { matchLabels: {} } },
            {},
            {
              name: "web-abc123",
              namespace: "default",
              ownerReferences: [{ kind: "Deployment", name: "web" }],
            },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("Deployment/web")).toBeDefined();
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits Managed By when the workload has no owner", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Managed By")).toBeNull();
    });

    it("shows conditions as a row of status pills", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "Deployment",
            { replicas: 1, selector: { matchLabels: {} } },
            {
              conditions: [
                { type: "Available", status: "True", reason: "MinimumReplicasAvailable" },
                { type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded" },
              ],
            },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("Available")).toBeDefined();
      expect(screen.getByText("Progressing")).toBeDefined();
    });

    it("omits the Conditions row when the workload reports none", () => {
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Conditions")).toBeNull();
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
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", { replicas: 1, selector: { matchLabels: {} } })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Service")).toBeNull();
      expect(screen.queryByText("Volume claim templates")).toBeNull();
    });

    it("omits volume claim templates for a StatefulSet that declares none", () => {
      render(
        <WorkloadDetailsBody
          object={workload("StatefulSet", {
            replicas: 1,
            selector: { matchLabels: {} },
            serviceName: "web-headless",
          })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Volume claim templates")).toBeNull();
    });

    it("fetches and shows the related pods matched by the selector", async () => {
      podsForSelector.mockResolvedValue({ pods: [POD_A] });
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", {
            replicas: 1,
            selector: { matchLabels: { app: "web" } },
          })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("web-abc-1")).toBeDefined());
      expect(podsForSelector).toHaveBeenCalledWith("ctx", "default", { app: "web" });
      expect(screen.getAllByText("node-a").length).toBeGreaterThan(0);
      // Pod name and node are inert text — no navigation contract exists here.
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("shows No pods when the selector matches nothing", async () => {
      podsForSelector.mockResolvedValue({ pods: [] });
      render(
        <WorkloadDetailsBody
          object={workload("Deployment", {
            replicas: 3,
            selector: { matchLabels: { app: "web" } },
          })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("No pods")).toBeDefined());
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
      // Not a "3 desired, ... total" replica summary — the DaemonSet form.
      expect(screen.queryByText(/desired,/)).toBeNull();
    });

    it("shows zero per-node numbers for a DaemonSet with no nodes matching", () => {
      render(
        <WorkloadDetailsBody
          object={workload(
            "DaemonSet",
            { selector: { matchLabels: { app: "logging" } } },
            {
              desiredNumberScheduled: 0,
              currentNumberScheduled: 0,
              numberReady: 0,
              updatedNumberScheduled: 0,
              numberAvailable: 0,
            },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("Desired")).toBeDefined();
      expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    });

    it("shows the update strategy via core's updateStrategyText", () => {
      render(
        <WorkloadDetailsBody
          object={workload("DaemonSet", {
            selector: { matchLabels: { app: "logging" } },
            updateStrategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1 } },
          })}
          context="ctx"
        />,
      );
      expect(screen.getByText("RollingUpdate (max unavailable 1)")).toBeDefined();
    });

    it("shows the selector", () => {
      render(
        <WorkloadDetailsBody
          object={workload("DaemonSet", { selector: { matchLabels: { app: "logging" } } })}
          context="ctx"
        />,
      );
      expect(screen.getByTitle("app=logging")).toBeDefined();
    });

    it("omits the selector row and fetches no related pods for a DaemonSet with no selector", async () => {
      render(<WorkloadDetailsBody object={workload("DaemonSet", {})} context="ctx" />);
      expect(screen.queryByText("Selector")).toBeNull();
      expect(screen.queryByText("Pods")).toBeNull();
      await Promise.resolve();
      expect(podsForSelector).not.toHaveBeenCalled();
    });

    it("fetches and shows the related pods matched by the DaemonSet's selector", async () => {
      podsForSelector.mockResolvedValue({ pods: [POD_A] });
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
      await waitFor(() => expect(screen.getByText("web-abc-1")).toBeDefined());
      expect(podsForSelector).toHaveBeenCalledWith("ctx", "kube-system", { app: "logging" });
    });
  });
});
