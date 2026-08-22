import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { K8sObject, PodSummary, PodMetric } from "@srelens/core";

// `GenericBody`'s "Pods" section reads live pods/metrics for a kind's
// related-pod selector via core's `podsForSelector`/`podMetrics` — mocked
// here so a test controls what "the cluster said" without one.
// `importOriginal` keeps every formatter (`relatedPodSelector`, `str`,
// `conditionKind`, ...) intact.
const { podsForSelector, podMetrics } = vi.hoisted(() => ({
  podsForSelector: vi.fn(async (): Promise<{ pods?: PodSummary[]; error?: string }> => ({ pods: [] })),
  podMetrics: vi.fn(async (): Promise<{ metrics?: PodMetric[]; error?: string }> => ({ metrics: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  podsForSelector,
  podMetrics,
}));

import { GenericBody, SELF_DESCRIBING_KINDS } from "./GenericBody";

function object(
  kind: string,
  spec: Record<string, unknown> = {},
  status: Record<string, unknown> = {},
  metadata: NonNullable<K8sObject["metadata"]> = { name: "obj-1", namespace: "default" },
): K8sObject {
  return { kind, apiVersion: "v1", metadata, spec, status } as K8sObject;
}

describe("GenericBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    podsForSelector.mockResolvedValue({ pods: [] });
    podMetrics.mockResolvedValue({ metrics: [] });
  });

  describe("a kind with no specific body", () => {
    // Lease has no `DETAILS_BODY` entry in `ResourceDetail` and is not one of
    // `SELF_DESCRIBING_KINDS` — exactly the ~23-kind case this task exists
    // to fix: no `children` at all, the wrapper alone must be a complete,
    // correct detail.
    const LEASE = object(
      "Lease",
      {},
      {},
      {
        name: "lease-1",
        namespace: "kube-node-lease",
        creationTimestamp: "2026-08-20T00:00:00Z",
        labels: { app: "controller" },
        annotations: { "kubectl.kubernetes.io/note": "renewed automatically" },
        ownerReferences: [{ kind: "Node", name: "node-a" }],
      },
    );

    it("renders every Metadata fact, with cross-resource references as plain text", () => {
      render(<GenericBody kind="Lease" object={LEASE} context="ctx" />);
      expect(screen.getByText("Metadata")).toBeDefined();
      expect(screen.getByText("lease-1")).toBeDefined();
      expect(screen.getByText("kube-node-lease")).toBeDefined();
      expect(screen.getByText(/ago \(/)).toBeDefined(); // Created: timestampWithAge
      expect(screen.getByText("Node/node-a")).toBeDefined();
      expect(screen.getByTitle("app=controller")).toBeDefined();
      expect(screen.getByTitle("kubectl.kubernetes.io/note=renewed automatically")).toBeDefined();

      // Namespace and Controlled by are `ResourceLink`/`LinkedResources` in
      // classic that navigate; nothing here can (`PaneBody` has no
      // navigation contract — see the task report), so neither renders as a
      // navigation control.
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits absent Metadata facts rather than showing them empty", () => {
      const bare = object("Lease", {}, {}, { name: "bare-lease" });
      render(<GenericBody kind="Lease" object={bare} context="ctx" />);
      expect(screen.getByText("Metadata")).toBeDefined();
      expect(screen.getByText("bare-lease")).toBeDefined();
      expect(screen.queryByText("Namespace")).toBeNull();
      expect(screen.queryByText("Created")).toBeNull();
      expect(screen.queryByText("Controlled by")).toBeNull();
      expect(screen.queryByText("Labels")).toBeNull();
      expect(screen.queryByText("Annotations")).toBeNull();
    });
  });

  describe("a kind with a DETAILS_BODY entry", () => {
    it("renders the wrapper's Metadata and the nested body together, in classic's order", () => {
      const { container } = render(
        <GenericBody kind="ConfigMap" object={object("ConfigMap")} context="ctx">
          <div data-testid="nested-body">Nested kind body</div>
        </GenericBody>,
      );
      expect(screen.getByText("Metadata")).toBeDefined();
      expect(screen.getByTestId("nested-body")).toBeDefined();

      // Metadata precedes the nested body in the DOM — classic's
      // `GenericDetail` nests `KindBody` after its own "Metadata" section.
      const metadataHeading = screen.getByText("Metadata");
      const nested = screen.getByTestId("nested-body");
      // eslint-disable-next-line no-bitwise
      expect(metadataHeading.compareDocumentPosition(nested) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.textContent?.indexOf("Metadata")).toBeLessThan(
        container.textContent?.indexOf("Nested kind body") ?? -1,
      );
    });
  });

  describe("related pods", () => {
    it("renders related pods for a kind whose relatedPodSelector finds one", async () => {
      podsForSelector.mockResolvedValue({
        pods: [
          { name: "svc-pod-1", namespace: "default", phase: "Running", ready: "1/1", restarts: 0, node: "node-a", age: "2d", image: "app:1.0" },
        ],
      });
      render(
        <GenericBody
          kind="Service"
          object={object("Service", { selector: { app: "web" } }, {}, { name: "web", namespace: "default" })}
          context="ctx"
        />,
      );
      await waitFor(() => expect(screen.getByText("Pods")).toBeDefined());
      await waitFor(() => expect(screen.getByText("svc-pod-1")).toBeDefined());
      expect(podsForSelector).toHaveBeenCalledWith("ctx", "default", { app: "web" });
    });

    it("does not render related pods for a kind relatedPodSelector finds none for", () => {
      render(
        <GenericBody
          kind="ConfigMap"
          object={object("ConfigMap", {}, {}, { name: "cm-1", namespace: "default" })}
          context="ctx"
        />,
      );
      expect(screen.queryByText("Pods")).toBeNull();
      expect(podsForSelector).not.toHaveBeenCalled();
    });
  });

  describe("conditions", () => {
    it("renders conditions as a table", () => {
      render(
        <GenericBody
          kind="Lease"
          object={object(
            "Lease",
            {},
            { conditions: [{ type: "Ready", status: "True", reason: "AsExpected", lastTransitionTime: "2026-08-20T00:00:00Z" }] },
          )}
          context="ctx"
        />,
      );
      expect(screen.getByText("Conditions")).toBeDefined();
      expect(screen.getByText("Ready")).toBeDefined();
      expect(screen.getByText("True")).toBeDefined();
      expect(screen.getByText("AsExpected")).toBeDefined();
    });

    it("reads as empty rather than broken when the object reports no conditions", () => {
      render(<GenericBody kind="Lease" object={object("Lease", {}, {})} context="ctx" />);
      expect(screen.queryByText("Conditions")).toBeNull();
    });
  });

  describe("the four self-describing kinds", () => {
    it("lists exactly Pod, Deployment, StatefulSet and ReplicaSet", () => {
      expect([...SELF_DESCRIBING_KINDS].sort()).toEqual(
        ["Deployment", "Pod", "ReplicaSet", "StatefulSet"].sort(),
      );
    });

    it.each([...SELF_DESCRIBING_KINDS])("passes %s's children through without a second Metadata section", (kind) => {
      render(
        <GenericBody kind={kind} object={object(kind)} context="ctx">
          <div data-testid="own-body">Own Properties section</div>
        </GenericBody>,
      );
      expect(screen.getByTestId("own-body")).toBeDefined();
      expect(screen.queryByText("Metadata")).toBeNull();
    });

    // DaemonSet is deliberately NOT in `SELF_DESCRIBING_KINDS` — classic's
    // `ObjectDetail` does not special-case it either, so it still gets the
    // wrapper (and its own DaemonSetBody nests inside it, per classic's
    // `GenericDetail` + `KindBody`).
    it("still wraps DaemonSet, which classic does not special-case", () => {
      render(
        <GenericBody kind="DaemonSet" object={object("DaemonSet")} context="ctx">
          <div data-testid="daemonset-body">Scheduling</div>
        </GenericBody>,
      );
      expect(screen.getByText("Metadata")).toBeDefined();
      expect(screen.getByTestId("daemonset-body")).toBeDefined();
    });
  });
});
