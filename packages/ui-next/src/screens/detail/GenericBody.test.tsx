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

import userEvent from "@testing-library/user-event";
import { Section } from "@srelens/ui-kit";
import { GenericBody, SELF_DESCRIBING_KINDS } from "./GenericBody";

function object(
  kind: string,
  spec: Record<string, unknown> = {},
  status: Record<string, unknown> = {},
  metadata: NonNullable<K8sObject["metadata"]> = { name: "obj-1", namespace: "default" },
): K8sObject {
  return { kind, apiVersion: "v1", metadata, spec, status } as K8sObject;
}

/** Scans the whole rendered document for a substring — text content, `title`,
 *  `aria-label`, `data-*`, everything a DOM inspector or a screen reader
 *  would see, not only what a text query happens to match. A boolean
 *  assertion rather than an element query, so a failure here never prints
 *  the sensitive value into the test output — matches `SecretBody.test.tsx`'s
 *  own `documentContains` helper. */
function documentContains(value: string): boolean {
  return document.body.innerHTML.includes(value);
}

/**
 * A nested `DETAILS_BODY` in the shape every real one has: its blocks returned
 * as siblings of the wrapper's own, wrapped in nothing.
 * `ServiceDetailsBody`, `NodeDetailsBody`, `SecretDetailsBody` and the rest
 * all return a fragment for exactly this reason, and each pins it in its own
 * file. Used here so the wrapper's tests model a real body rather than the
 * mistake its doc comment warns about.
 */
function NestedBody({ title }: { title: string }) {
  return (
    <Section title={title} className="nested-body">
      {`${title} rows`}
    </Section>
  );
}

/**
 * The shape the wrapper's doc comment forbids: a nested body that returns its
 * blocks inside an element of its own.
 */
function WrappedBody() {
  return (
    <div>
      <Section title="Wrapped body">rows</Section>
    </div>
  );
}

/**
 * Whether the hairline chain is unbroken: `.section + .section` is the rule
 * that draws it, so every block of the run has to be a direct sibling of every
 * other. One element wrapped around one block costs the rule on both sides of
 * it — above and below — and nothing about the rendering looks wrong.
 */
function runIsUnbroken(container: HTMLElement): boolean {
  return [...container.children].every((el) => el.matches("section.section"));
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

    it("renders every identity fact, with cross-resource references as plain text", () => {
      render(<GenericBody kind="Lease" object={LEASE} context="ctx" />);
      expect(screen.getByText("kube-node-lease")).toBeDefined();
      expect(screen.getByText("Node/node-a")).toBeDefined();

      // Namespace and Controlled by are `ResourceLink`/`LinkedResources` in
      // classic that navigate; nothing here can (`PaneBody` has no
      // navigation contract — see the task report), so neither renders as a
      // navigation control.
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("heads the first fact list with nothing, the way the design does", () => {
      // The pane's own header has already named the subject; a "Metadata"
      // bar above the first list is a second name for it.
      render(<GenericBody kind="Lease" object={LEASE} context="ctx" />);
      expect(screen.queryByText("Metadata")).toBeNull();
      expect(screen.queryByRole("heading", { name: "Metadata" })).toBeNull();
    });

    it("drops Name, which repeats the header verbatim", () => {
      render(<GenericBody kind="Lease" object={LEASE} context="ctx" />);
      expect(screen.queryByText("Name")).toBeNull();
      expect(screen.queryByText("lease-1")).toBeNull();
    });

    it("dates the object by age alone, not age plus an absolute stamp", () => {
      render(<GenericBody kind="Lease" object={LEASE} context="ctx" />);
      expect(screen.getByText(/^\d+[smhd] ago$/)).toBeDefined();
      expect(screen.queryByText(/ago \(/)).toBeNull();
    });

    it("omits absent identity facts rather than showing them empty", () => {
      const bare = object("Lease", {}, {}, { name: "bare-lease" });
      render(<GenericBody kind="Lease" object={bare} context="ctx" />);
      expect(screen.queryByText("Namespace")).toBeNull();
      expect(screen.queryByText("Created")).toBeNull();
      expect(screen.queryByText("Controlled by")).toBeNull();
      expect(screen.queryByText("Labels")).toBeNull();
      expect(screen.queryByText("Annotations")).toBeNull();
    });
  });

  describe("the run of sections", () => {
    it("is flat blocks divided by rules, not a stack of cards", () => {
      const { container } = render(
        <GenericBody kind="Lease" object={object("Lease", {}, {}, { name: "l", namespace: "default" })} context="ctx" />,
      );
      expect(container.querySelector("section.section")).not.toBeNull();
      expect(container.querySelector(".card")).toBeNull();
    });

    it("lands every block as a sibling, the wrapper's own and the nested body's alike", () => {
      const { container } = render(
        <GenericBody
          kind="Lease"
          object={object(
            "Lease",
            {},
            { conditions: [{ type: "Ready", status: "True" }] },
            { name: "l", namespace: "default", labels: { app: "controller" } },
          )}
          context="ctx"
        >
          <NestedBody title="Nested kind body" />
        </GenericBody>,
      );
      expect(container.children.length).toBeGreaterThan(1);
      expect(runIsUnbroken(container)).toBe(true);
    });

    it("loses the rule on both sides of a nested body that wraps its own blocks", () => {
      // The invariant the wrapper's doc comment states, made checkable — and
      // the reason the check above is worth anything. A body returning its
      // blocks inside a div is a sibling of neither the block before it nor
      // the one after, so `.section + .section` matches at neither join and
      // two hairlines vanish with nothing else looking wrong. Asserted from
      // the violating side so the guard is known to discriminate rather than
      // to pass on any shape at all.
      const { container } = render(
        <GenericBody
          kind="Lease"
          object={object("Lease", {}, { conditions: [{ type: "Ready", status: "True" }] }, {
            name: "l",
            namespace: "default",
          })}
          context="ctx"
        >
          <WrappedBody />
        </GenericBody>,
      );
      expect(runIsUnbroken(container)).toBe(false);
      const wrapped = [...container.children].filter((el) => !el.matches("section.section"));
      expect(wrapped.map((el) => el.tagName)).toEqual(["DIV"]);
    });

    it("renders no block at all when a block has nothing to say", () => {
      // An empty section still has padding and still draws a rule against the
      // next one, so a missing middle block must be absent, not blank.
      const { container } = render(
        <GenericBody kind="Lease" object={object("Lease", {}, {}, { name: "bare-lease" })} context="ctx" />,
      );
      expect(container.querySelectorAll("section.section")).toHaveLength(0);
    });

    it("leaves the nested body first in the run when the object has no identity facts to show", () => {
      const { container } = render(
        <GenericBody kind="ConfigMap" object={object("ConfigMap", {}, {}, { name: "cm-1" })} context="ctx">
          <NestedBody title="Nested kind body" />
        </GenericBody>,
      );
      expect(container.children[0]).toBe(container.querySelector(".nested-body"));
      expect(runIsUnbroken(container)).toBe(true);
    });
  });

  describe("Labels", () => {
    const LABELLED = object(
      "Lease",
      {},
      {},
      { name: "l", namespace: "default", labels: { app: "checkout", tier: "backend" } },
    );

    it("gets a block of its own rather than a row squeezed into a fact list", () => {
      render(<GenericBody kind="Lease" object={LABELLED} context="ctx" />);
      expect(screen.getByRole("heading", { level: 3, name: "Labels" })).toBeDefined();
      expect(screen.getByText("app=")).toBeDefined();
      expect(screen.getByText("checkout")).toBeDefined();
    });

    it("wraps a long value instead of truncating it", () => {
      // `PairList` no longer writes the value into a `title`, so wrapping is
      // the only way a long label can be read at all.
      const { container } = render(<GenericBody kind="Lease" object={LABELLED} context="ctx" />);
      const rows = [...container.querySelectorAll(".pairs li")];
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.className).not.toContain("truncate");
      expect(container.querySelector(".pairs .v.break-all")).not.toBeNull();
    });
  });

  describe("Annotations", () => {
    it("shows them expanded, with no toggle, on an ordinary kind", () => {
      render(
        <GenericBody
          kind="ConfigMap"
          object={object("ConfigMap", {}, {}, { name: "cm-1", annotations: { "srelens.io/note": "hello" } })}
          context="ctx"
        />,
      );
      expect(screen.getByRole("heading", { level: 3, name: "Annotations" })).toBeDefined();
      expect(screen.getByText("hello")).toBeDefined();
      expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
    });
  });

  describe("the annotations secrecy gate, which survives on Secret alone", () => {
    // Obviously-fake fixture text — never anything that reads as a real
    // manifest or credential.
    const FIXTURE_VALUE = "fixture-only-not-a-real-last-applied-manifest";

    // A `kubectl apply`-managed Secret: `last-applied-configuration` holds
    // the ENTIRE applied manifest, including the base64 `data` map —
    // `k8s.getObject`'s Secret redaction never touches `metadata.annotations`,
    // so this fixture is the exact shape the finding was about.
    const KUBECTL_MANAGED_SECRET = object(
      "Secret",
      {},
      {},
      {
        name: "managed-secret",
        namespace: "default",
        annotations: { "kubectl.kubernetes.io/last-applied-configuration": FIXTURE_VALUE },
      },
    );

    it("keeps the annotation value out of the document until expanded, then shows it, then hides it again", async () => {
      render(<GenericBody kind="Secret" object={KUBECTL_MANAGED_SECRET} context="ctx" />);

      // Not as text, not as a title/aria-label/data-*, not anywhere in the
      // markup — nothing under the toggle is mounted at all yet.
      expect(documentContains(FIXTURE_VALUE)).toBe(false);
      expect(screen.queryByText(FIXTURE_VALUE)).toBeNull();

      const toggle = screen.getByRole("button", { name: "Show 1 annotation" });
      await userEvent.click(toggle);
      await waitFor(() => expect(documentContains(FIXTURE_VALUE)).toBe(true));

      await userEvent.click(screen.getByRole("button", { name: "Hide" }));
      expect(documentContains(FIXTURE_VALUE)).toBe(false);
    });

    it("never carries the value in the toggle's own title or accessible name", () => {
      render(<GenericBody kind="Secret" object={KUBECTL_MANAGED_SECRET} context="ctx" />);
      const toggle = screen.getByRole("button", { name: "Show 1 annotation" });
      expect(toggle.getAttribute("title")).toBeNull();
      expect(toggle.getAttribute("aria-label")).toBeNull();
      // The accessible name itself (asserted via `getByRole`'s `name` match
      // above) is the count-only "Show 1 annotation" text, not the value.
    });

    it("gates Secret and nothing else — every other kind's annotations are open, as the design draws them", () => {
      // Asserted on an ORDINARY annotation, deliberately. The applied-manifest
      // key cannot show this any more: the shared `AnnotationLines` holds that
      // one key back on every kind for legibility, so using it here would
      // prove nothing about the gate.
      const configMap = object(
        "ConfigMap",
        {},
        {},
        { name: "cm-1", namespace: "default", annotations: { "srelens.io/last-applied-by": "dana@acme.io" } },
      );
      render(<GenericBody kind="ConfigMap" object={configMap} context="ctx" />);
      expect(documentContains("dana@acme.io")).toBe(true);
      expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
    });

    it("still gates a Secret whose applied manifest the shared rule would have withheld anyway", () => {
      // The two rules must not be confused for one. `AnnotationLines` drops
      // `last-applied-configuration` for legibility and would happen to drop
      // this value too — but a Secret never reaches it. The gate is what keeps
      // the value out of the document, and it is still the gate doing it.
      render(<GenericBody kind="Secret" object={KUBECTL_MANAGED_SECRET} context="ctx" />);
      expect(documentContains(FIXTURE_VALUE)).toBe(false);
      expect(screen.getByRole("button", { name: "Show 1 annotation" })).toBeDefined();
    });

    it("withholds an ordinary kind's applied manifest for length, and says where to read it", () => {
      // A legibility rule, not redaction: a manifest on one line buries every
      // other annotation in a 352px pane. The shorter annotation beside it is
      // still printed in full.
      const configMap = object(
        "ConfigMap",
        {},
        {},
        {
          name: "cm-1",
          namespace: "default",
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration": FIXTURE_VALUE,
            "srelens.io/last-applied-by": "dana@acme.io",
          },
        },
      );
      render(<GenericBody kind="ConfigMap" object={configMap} context="ctx" />);
      expect(documentContains(FIXTURE_VALUE)).toBe(false);
      expect(screen.getByText(/kubectl.kubernetes.io\/last-applied-configuration/).textContent).toMatch(/YAML/);
      expect(documentContains("dana@acme.io")).toBe(true);
    });
  });

  describe("a kind with a DETAILS_BODY entry", () => {
    it("renders the wrapper's facts and the nested body together, in classic's order", () => {
      const { container } = render(
        <GenericBody kind="ConfigMap" object={object("ConfigMap")} context="ctx">
          <NestedBody title="Nested kind body" />
        </GenericBody>,
      );
      expect(screen.getByText("Namespace")).toBeDefined();
      expect(screen.getByRole("heading", { level: 3, name: "Nested kind body" })).toBeDefined();

      // The wrapper's own facts precede the nested body in the DOM — classic's
      // `GenericDetail` nests `KindBody` after its own metadata section.
      const namespaceKey = screen.getByText("Namespace");
      const nested = screen.getByRole("heading", { level: 3, name: "Nested kind body" });
      // eslint-disable-next-line no-bitwise
      expect(namespaceKey.compareDocumentPosition(nested) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.textContent?.indexOf("Namespace")).toBeLessThan(
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
    it("renders conditions as the shared rows, not a sortable table", () => {
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
      expect(screen.getByRole("heading", { level: 3, name: "Conditions" })).toBeDefined();
      expect(screen.getByText("Ready")).toBeDefined();
      expect(screen.getByText("True · AsExpected")).toBeDefined();
      expect(screen.queryByText("Last transition")).toBeNull();
      expect(screen.queryByRole("columnheader")).toBeNull();
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

    it.each([...SELF_DESCRIBING_KINDS])("passes %s's children through without a second identity block", (kind) => {
      render(
        <GenericBody kind={kind} object={object(kind)} context="ctx">
          <NestedBody title="Own properties" />
        </GenericBody>,
      );
      expect(screen.getByRole("heading", { level: 3, name: "Own properties" })).toBeDefined();
      expect(screen.queryByText("Namespace")).toBeNull();
    });

    // DaemonSet is deliberately NOT in `SELF_DESCRIBING_KINDS` — classic's
    // `ObjectDetail` does not special-case it either, so it still gets the
    // wrapper (and its own DaemonSetBody nests inside it, per classic's
    // `GenericDetail` + `KindBody`).
    it("still wraps DaemonSet, which classic does not special-case", () => {
      render(
        <GenericBody kind="DaemonSet" object={object("DaemonSet")} context="ctx">
          <NestedBody title="Scheduling" />
        </GenericBody>,
      );
      expect(screen.getByText("Namespace")).toBeDefined();
      expect(screen.getByRole("heading", { level: 3, name: "Scheduling" })).toBeDefined();
    });
  });
});
