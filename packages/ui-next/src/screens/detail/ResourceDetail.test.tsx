import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, useLayoutEffect, type ReactElement, type ReactNode } from "react";
import { render as renderBare, screen, waitFor, within, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CrdRef, EventSummary, K8sObject } from "@srelens/core";
import { toneColor } from "@srelens/ui-kit";
import type { KindDescriptor, ListRow } from "../../lib/kinds/types";

// `useObject` reads `getObject`; the YAML and Events panes read `getManifest`
// and `listEvents` directly, and the YAML pane also reads `listCrds` to
// resolve a custom resource's group/version/plural before fetching its
// manifest. All four are core's, mocked here so a test controls what "the
// cluster said" without one — `importOriginal` keeps everything else
// (K8S_KIND, and the real types) intact.
const { getObject, getManifest, listEvents, listCrds, deleteResource } = vi.hoisted(() => ({
  getObject: vi.fn(async (): Promise<{ object?: K8sObject; error?: string }> => ({})),
  getManifest: vi.fn(async (): Promise<{ yaml?: string; error?: string }> => ({ yaml: "" })),
  listEvents: vi.fn(async (): Promise<{ events?: EventSummary[]; error?: string }> => ({ events: [] })),
  listCrds: vi.fn(async (): Promise<{ crds?: CrdRef[]; error?: string }> => ({ crds: [] })),
  // The footer's actions are the row menu's, so the one write a test reaches
  // for is mocked here too — a confirm that is never taken must reach nothing.
  deleteResource: vi.fn(async (): Promise<{ error?: string }> => ({})),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  getObject,
  getManifest,
  listEvents,
  listCrds,
  deleteResource,
}));

// The shell asks the same descriptor the list screen resolves, only to read
// `panes` off it — mocked so a test can hand it a kind with or without
// Containers/Metrics without depending on which real kinds have that set.
const { descriptorFor } = vi.hoisted(() => ({
  descriptorFor: vi.fn((_slug: string): KindDescriptor<ListRow> | undefined => undefined),
}));

vi.mock("../../lib/kinds/descriptors", () => ({ descriptorFor }));

// The kit's `CodeEditor`, unchanged — wrapped only to record what the YAML
// pane hands it. CodeMirror compiles its sizing into a generated stylesheet
// with hashed class names and jsdom applies no CSS, so what the editor was
// ASKED for is the only thing observable here (`CodeEditor.test.tsx` says the
// same, at greater length). Everything else in the kit stays real.
const { codeEditorProps } = vi.hoisted(() => ({ codeEditorProps: [] as Record<string, unknown>[] }));

vi.mock("@srelens/ui-kit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@srelens/ui-kit")>();
  return {
    ...actual,
    CodeEditor: (props: Record<string, unknown>) => {
      codeEditorProps.push({ ...props });
      return createElement(actual.CodeEditor, props as never);
    },
  };
});

import { ConsoleProvider, useConsole } from "../../console";
import { ResourceDetail } from "./ResourceDetail";

/** Every question the console was handed, in order. */
const asked: string[] = [];

/** Stands in for the console dock: the thing `ask` delivers to. */
function AskProbe() {
  const { registerSubmit } = useConsole();
  useLayoutEffect(() => registerSubmit((question) => void asked.push(question)), [registerSubmit]);
  return null;
}

/**
 * Every render goes through the provider the real shell mounts at the root:
 * the pane's footer reaches `useConsole()` for its Ask button, and that hook
 * throws rather than quietly handing back nothing. The probe rides along so a
 * test can read what was actually asked.
 */
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <ConsoleProvider>
      <AskProbe />
      {children}
    </ConsoleProvider>
  );
}

function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return renderBare(ui, { wrapper: Wrapper, ...options });
}

const POD: K8sObject = {
  kind: "Pod",
  apiVersion: "v1",
  metadata: { name: "web-1", namespace: "default" },
};

const POD_2: K8sObject = {
  kind: "Pod",
  apiVersion: "v1",
  metadata: { name: "web-2", namespace: "default" },
};

const CONFIGMAP: K8sObject = {
  kind: "ConfigMap",
  apiVersion: "v1",
  metadata: { name: "cm-1", namespace: "default" },
};

/** Scans the whole rendered document for a substring — text content, `title`,
 *  `aria-label`, `data-*`, everything, including markup a screen reader or a
 *  DOM inspector would see even while visually hidden. A boolean assertion
 *  rather than an element query, so a failure here never prints the secret
 *  text into the test output. Same helper, and the same reasoning, as
 *  `SecretBody.test.tsx`'s. */
function documentContains(value: string): boolean {
  return document.body.innerHTML.includes(value);
}

// Obviously-fake fixture text — never anything that reads as a real
// credential, per this screen's secrecy ruling.
const FIXTURE_B64 = "ZmFrZS1maXh0dXJlLW5vdC1hLXJlYWwtc2VjcmV0";

const SECRET: K8sObject = {
  kind: "Secret",
  apiVersion: "v1",
  metadata: { name: "s-1", namespace: "default" },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** An ISO timestamp a whole number of days old, so `ageFromTimestamp` reads it
 *  back as exactly that many days. Relative rather than a fixed date: the
 *  clock cannot be frozen here (`userEvent` needs real timers) and a literal
 *  stamp would rot into a bigger number every day. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** Frame A of the mock: a Deployment short of its replicas. */
const DEGRADED_DEPLOYMENT: K8sObject = {
  kind: "Deployment",
  apiVersion: "apps/v1",
  metadata: { name: "checkout-api", namespace: "checkout", creationTimestamp: daysAgo(84) },
  spec: { replicas: 12 },
  status: { readyReplicas: 9 },
};

/** Frame B of the mock: a Pod doing exactly what it was asked to. */
const RUNNING_POD: K8sObject = {
  kind: "Pod",
  apiVersion: "v1",
  metadata: { name: "cart-session-store-0", namespace: "checkout", creationTimestamp: daysAgo(211) },
  status: { phase: "Running", containerStatuses: [{ name: "redis", ready: true, state: { running: {} } }] },
};

/** A kind `resourceStatusLine` has no verdict for, aged so an age fact would
 *  have something to draw if one were drawn at all. */
const AGED_CONFIGMAP: K8sObject = {
  kind: "ConfigMap",
  apiVersion: "v1",
  metadata: { name: "cm-1", namespace: "default", creationTimestamp: daysAgo(30) },
};

function baseDescriptor(overrides: Partial<KindDescriptor<ListRow>> = {}): KindDescriptor<ListRow> {
  return { k8sKind: "Pod", columns: [], source: "watch", scope: "namespaced", actions: {}, ...overrides };
}

describe("ResourceDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getManifest.mockResolvedValue({ yaml: "kind: Pod\n" });
    listEvents.mockResolvedValue({ events: [] });
    listCrds.mockResolvedValue({ crds: [] });
    descriptorFor.mockReturnValue(undefined);
    codeEditorProps.length = 0;
    asked.length = 0;
  });

  it("shows a loading state while the object is in flight", () => {
    getObject.mockImplementation(() => new Promise(() => {}));
    const { getByText } = render(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />);
    expect(getByText(/loading/i)).toBeDefined();
  });

  it("renders Details, YAML and Events once ready, and no Containers or Metrics for a kind whose descriptor doesn't offer them", async () => {
    getObject.mockResolvedValue({ object: POD });
    const { getByRole, queryByRole } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "Details" })).toBeDefined());
    expect(getByRole("tab", { name: "YAML" })).toBeDefined();
    expect(getByRole("tab", { name: "Events" })).toBeDefined();
    expect(queryByRole("tab", { name: "Containers" })).toBeNull();
    expect(queryByRole("tab", { name: "Metrics" })).toBeNull();
  });

  it("names the object in the error state", async () => {
    getObject.mockResolvedValue({ error: "forbidden" });
    const { getByRole } = render(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />);
    await waitFor(() => expect(getByRole("alert")).toBeDefined());
    const text = getByRole("alert").textContent ?? "";
    expect(text).toContain("Pod");
    expect(text).toContain("web-1");
  });

  it("offers Containers only for a kind whose descriptor sets panes.containers", async () => {
    getObject.mockResolvedValue({ object: POD });
    descriptorFor.mockReturnValue(baseDescriptor({ panes: { containers: true } }));
    const { getByRole, queryByRole } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "Containers" })).toBeDefined());
    expect(queryByRole("tab", { name: "Metrics" })).toBeNull();
  });

  it("offers Metrics only for a kind whose descriptor sets panes.metrics", async () => {
    getObject.mockResolvedValue({ object: { kind: "Node", metadata: { name: "n1" } } });
    descriptorFor.mockReturnValue(baseDescriptor({ k8sKind: "Node", scope: "cluster", panes: { metrics: true } }));
    const { getByRole, queryByRole } = render(<ResourceDetail context="ctx" kind="Node" namespace={null} name="n1" />);
    await waitFor(() => expect(getByRole("tab", { name: "Metrics" })).toBeDefined());
    expect(queryByRole("tab", { name: "Containers" })).toBeNull();
  });

  it("loads YAML and Events lazily, only once each pane is opened, and never refetches a pane already opened", async () => {
    getObject.mockResolvedValue({ object: POD });
    const { getByRole } = render(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />);
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());

    // A reader who never leaves Details pays for the object alone — a peek
    // fills on nearly every row click, and YAML/Events are usually never
    // looked at.
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(getManifest).not.toHaveBeenCalled();
    expect(listEvents).not.toHaveBeenCalled();

    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getManifest).toHaveBeenCalledTimes(1));
    expect(listEvents).not.toHaveBeenCalled();

    await userEvent.click(getByRole("tab", { name: "Events" }));
    await waitFor(() => expect(listEvents).toHaveBeenCalledTimes(1));

    // Switching back to Details, then to both already-opened panes again,
    // must not re-fire any of the three loads.
    await userEvent.click(getByRole("tab", { name: "Details" }));
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await userEvent.click(getByRole("tab", { name: "Events" }));

    expect(getObject).toHaveBeenCalledTimes(1);
    expect(getManifest).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state for the manifest while it is in flight", async () => {
    getObject.mockResolvedValue({ object: POD });
    getManifest.mockImplementation(() => new Promise(() => {}));
    const { getByRole, getByText } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    expect(getByText(/loading.*manifest/i)).toBeDefined();
  });

  it("renders the fetched manifest once the YAML pane is opened", async () => {
    getObject.mockResolvedValue({ object: POD });
    getManifest.mockResolvedValue({ yaml: "kind: Pod\nspec:\n  nodeName: node-7\n" });
    const { getByRole, container } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("node-7"));
  });

  it("keeps the YAML pane usable when the manifest fetch fails", async () => {
    getObject.mockResolvedValue({ object: POD });
    getManifest.mockResolvedValue({ error: "forbidden" });
    const { getByRole } = render(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />);
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getByRole("alert")).toBeDefined());
    const text = getByRole("alert").textContent ?? "";
    // Names the object that failed, same convention as the object's own
    // error state — several panes can be open at once.
    expect(text).toContain("Pod");
    expect(text).toContain("web-1");

    // "Usable" means the rest of the shell still works after the failure —
    // other tabs remain clickable and render, rather than the whole
    // component wedging on the one failed pane.
    await userEvent.click(getByRole("tab", { name: "Details" }));
    await waitFor(() => expect(getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true"));
  });

  it("renders event rows once the Events pane is opened for a resource with events", async () => {
    getObject.mockResolvedValue({ object: POD });
    listEvents.mockResolvedValue({
      events: [
        { name: "web-1.abc", type: "Warning", reason: "BackOff", object: "Pod/web-1", message: "container crashed", age: "5m" },
        { name: "web-1.def", type: "Normal", reason: "Scheduled", object: "Pod/web-1", message: "assigned to node-3", age: "10m" },
      ],
    });
    const { getByRole, getByText } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "Events" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "Events" }));
    await waitFor(() => expect(getByText("BackOff")).toBeDefined());
    expect(getByText("container crashed")).toBeDefined();
    expect(getByText("Scheduled")).toBeDefined();
    expect(getByText("assigned to node-3")).toBeDefined();
  });

  it("does not query the cluster's CRDs to fetch a built-in kind's manifest", async () => {
    getObject.mockResolvedValue({ object: POD });
    const { getByRole } = render(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />);
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getManifest).toHaveBeenCalledTimes(1));
    expect(listCrds).not.toHaveBeenCalled();
    expect(getManifest).toHaveBeenCalledWith("ctx", "Pod", "default", "web-1", undefined, undefined);
  });

  it("resolves a custom resource's group/version/plural from the cluster's CRDs and passes it to getManifest", async () => {
    getObject.mockResolvedValue({ object: { kind: "Certificate", metadata: { name: "cert-1", namespace: "default" } } });
    listCrds.mockResolvedValue({
      crds: [
        {
          name: "certificates.cert-manager.io",
          group: "cert-manager.io",
          version: "v1",
          kind: "Certificate",
          plural: "certificates",
          namespaced: true,
        },
      ],
    });
    getManifest.mockResolvedValue({ yaml: "kind: Certificate\n" });
    const { getByRole } = render(
      <ResourceDetail context="ctx" kind="Certificate" namespace="default" name="cert-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getManifest).toHaveBeenCalledTimes(1));
    expect(getManifest).toHaveBeenCalledWith("ctx", "Certificate", "default", "cert-1", undefined, {
      group: "cert-manager.io",
      version: "v1",
      plural: "certificates",
    });
  });

  it("shows a distinct, informative error when no CRD on the cluster matches the custom resource's kind", async () => {
    getObject.mockResolvedValue({ object: { kind: "Certificate", metadata: { name: "cert-1", namespace: "default" } } });
    listCrds.mockResolvedValue({ crds: [] });
    const { getByRole } = render(
      <ResourceDetail context="ctx" kind="Certificate" namespace="default" name="cert-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getByRole("alert")).toBeDefined());
    const text = getByRole("alert").textContent ?? "";
    expect(text).toContain("Certificate");
    // Distinct from a generic manifest-fetch failure: names the real reason
    // (no matching CustomResourceDefinition), not a bare "could not load".
    expect(text.toLowerCase()).toContain("customresourcedefinition");
    expect(getManifest).not.toHaveBeenCalled();
  });

  it("shows a distinct error when the cluster's CRDs themselves fail to load", async () => {
    getObject.mockResolvedValue({ object: { kind: "Certificate", metadata: { name: "cert-1", namespace: "default" } } });
    listCrds.mockResolvedValue({ error: "forbidden" });
    const { getByRole } = render(
      <ResourceDetail context="ctx" kind="Certificate" namespace="default" name="cert-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getByRole("alert")).toBeDefined());
    const text = getByRole("alert").textContent ?? "";
    expect(text).toContain("Certificate");
    expect(text).toContain("forbidden");
    expect(getManifest).not.toHaveBeenCalled();
  });

  it("shows a labelled empty state for a resource with no events, not a blank pane", async () => {
    getObject.mockResolvedValue({ object: POD });
    listEvents.mockResolvedValue({ events: [] });
    const { getByRole, getByText, queryByRole } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "Events" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "Events" }));
    await waitFor(() => expect(getByText("No events")).toBeDefined());
    // Distinguishable from the error state below: no alert renders alongside it.
    expect(queryByRole("alert")).toBeNull();
  });

  it("shows the error state for events that failed to load, distinct from the empty-events state", async () => {
    getObject.mockResolvedValue({ object: POD });
    listEvents.mockResolvedValue({ error: "forbidden" });
    const { getByRole, queryByText } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "Events" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "Events" }));
    await waitFor(() => expect(getByRole("alert")).toBeDefined());
    expect(getByRole("alert").textContent ?? "").toContain("web-1");
    // Distinguishable from the empty state above: no "No events" label renders.
    expect(queryByText("No events")).toBeNull();
  });

  it("does not reuse a previously-opened pane's data after the subject changes on an already-mounted shell", async () => {
    getObject.mockResolvedValueOnce({ object: POD });
    getManifest.mockResolvedValueOnce({ yaml: "kind: Pod\nmetadata:\n  name: web-1\n" });

    const { getByRole, container, rerender } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("web-1"));

    // A different pod, same shell instance — the peek fills like this on
    // nearly every row click.
    getObject.mockResolvedValueOnce({ object: POD_2 });
    getManifest.mockResolvedValueOnce({ yaml: "kind: Pod\nmetadata:\n  name: web-2\n" });
    rerender(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-2" />);

    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("web-2"));
    expect(container.querySelector(".cm-content")?.textContent).not.toContain("web-1");
    expect(getManifest).toHaveBeenCalledTimes(2);
  });

  it("persists the selected pane across a subject change when the new subject's kind also offers it", async () => {
    getObject.mockResolvedValueOnce({ object: POD });
    const { getByRole, rerender } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getByRole("tab", { name: "YAML" }).getAttribute("aria-selected")).toBe("true"));

    getObject.mockResolvedValueOnce({ object: POD_2 });
    rerender(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-2" />);

    await waitFor(() => expect(getByRole("heading").textContent).toBe("web-2"));
    // Still on YAML — comparing YAML (or scanning Events) across several rows
    // is a normal workflow, and every row click must not throw the reader
    // back to Details.
    expect(getByRole("tab", { name: "YAML" }).getAttribute("aria-selected")).toBe("true");
  });

  it("falls back to Details when the newly selected subject's kind doesn't offer the previously selected pane", async () => {
    descriptorFor.mockImplementation((slug: string) =>
      slug === "pods" ? baseDescriptor({ panes: { containers: true } }) : undefined,
    );
    getObject.mockResolvedValueOnce({ object: POD });
    const { getByRole, queryByRole, rerender } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "Containers" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "Containers" }));
    await waitFor(() =>
      expect(getByRole("tab", { name: "Containers" }).getAttribute("aria-selected")).toBe("true"),
    );

    // A ConfigMap's descriptor offers no Containers pane — the guard that
    // already exists for "this kind doesn't have the selected pane" is what
    // must catch this, not a reset that also clobbers the persist case above.
    getObject.mockResolvedValueOnce({ object: CONFIGMAP });
    rerender(<ResourceDetail context="ctx" kind="ConfigMap" namespace="default" name="cm-1" />);

    await waitFor(() => expect(getByRole("heading").textContent).toBe("cm-1"));
    expect(queryByRole("tab", { name: "Containers" })).toBeNull();
    expect(getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
  });

  it("never commits a frame that pairs the new subject's heading with the previous subject's content", async () => {
    // Settled-state assertions (as in the test above) cannot see this: RTL's
    // act() flushes passive effects synchronously, so by the time `await
    // waitFor(...)` resolves, any transient bad frame already happened and
    // was overwritten. A real browser has no such luxury — it paints
    // whatever was committed. This test records every committed frame with
    // a `useLayoutEffect` probe (which, like a browser's paint, runs
    // synchronously after each commit, before the next one) and asserts
    // none of them pairs one subject's heading with the other's content.
    getObject.mockResolvedValueOnce({ object: POD });
    getManifest.mockResolvedValueOnce({ yaml: "kind: Pod\nmetadata:\n  name: web-1\n" });

    const frames: Array<{ heading: string | null; content: string | null }> = [];

    function FrameProbe() {
      useLayoutEffect(() => {
        frames.push({
          heading: document.querySelector("h2")?.textContent ?? null,
          content: document.querySelector(".cm-content")?.textContent ?? null,
        });
      });
      return null;
    }

    function Harness(props: { namespace: string | null; name: string }) {
      return (
        <>
          <ResourceDetail context="ctx" kind="Pod" {...props} />
          <FrameProbe />
        </>
      );
    }

    const { rerender } = render(<Harness namespace="default" name="web-1" />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(screen.getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("web-1"));

    // Only frames from the subject change itself are under test.
    frames.length = 0;

    getObject.mockResolvedValueOnce({ object: POD_2 });
    getManifest.mockResolvedValueOnce({ yaml: "kind: Pod\nmetadata:\n  name: web-2\n" });
    rerender(<Harness namespace="default" name="web-2" />);

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("web-2"));

    const mismatched = frames.filter((f) => {
      if (!f.heading || !f.content) return false;
      const other = f.heading === "web-1" ? "web-2" : "web-1";
      return f.content.includes(`name: ${other}`) && !f.content.includes(`name: ${f.heading}`);
    });
    expect(mismatched).toEqual([]);
  });

  it("behaves identically in both hosts, apart from the peek's own controls", async () => {
    getObject.mockResolvedValue({ object: POD });
    const props = { context: "ctx", kind: "Pod", namespace: "default", name: "web-1" } as const;

    const withClose = render(<ResourceDetail {...props} peek={{ onClose: vi.fn(), onOpenTab: vi.fn() }} />);
    await waitFor(() => expect(withClose.getByRole("tab", { name: "YAML" })).toBeDefined());
    expect(withClose.getByRole("button", { name: "Close inspector" })).toBeDefined();
    const tabsWithClose = withClose.getAllByRole("tab").map((t) => t.textContent);
    // Scoped to the subject's own heading by name, not `getByRole("heading")`
    // bare: the Details pane's per-kind body (Task 10 on) can render its own
    // titled panels (`Panel`'s own `h2`, e.g. "Properties"), so more than one
    // heading is on screen once real content lands there.
    const headingWithClose = withClose.getByRole("heading", { name: "web-1" }).textContent;
    withClose.unmount();

    const withoutClose = render(<ResourceDetail {...props} />);
    await waitFor(() => expect(withoutClose.getByRole("tab", { name: "YAML" })).toBeDefined());
    expect(withoutClose.queryByRole("button", { name: "Close inspector" })).toBeNull();
    expect(withoutClose.getAllByRole("tab").map((t) => t.textContent)).toEqual(tabsWithClose);
    expect(withoutClose.getByRole("heading", { name: "web-1" }).textContent).toEqual(headingWithClose);
  });

  describe("the Secret YAML pane's redaction", () => {
    // The Details pane gates a Secret's values behind an explicit reveal.
    // The YAML pane sits one tab over and, left alone, hands the very same
    // values over with no gate at all — `k8s.getManifest` does not redact
    // (only `k8s.getObject` does). This is a deliberate divergence from
    // classic, which shows the manifest unredacted.
    it("keeps a Secret's values out of the document entirely", async () => {
      getObject.mockResolvedValue({ object: SECRET });
      getManifest.mockResolvedValue({
        yaml: `apiVersion: v1\nkind: Secret\nmetadata:\n  name: s-1\ndata:\n  token: ${FIXTURE_B64}\n`,
      });
      const { getByRole, container } = render(
        <ResourceDetail context="ctx" kind="Secret" namespace="default" name="s-1" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
      await userEvent.click(getByRole("tab", { name: "YAML" }));

      // Positive control first, so the absence assertion below cannot pass
      // vacuously on an editor that simply rendered nothing.
      await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("REDACTED"));
      expect(container.querySelector(".cm-content")?.textContent).toContain("token:");
      expect(documentContains(FIXTURE_B64)).toBe(false);
    });

    it("tells the reader the values are redacted and where to reveal them", async () => {
      getObject.mockResolvedValue({ object: SECRET });
      getManifest.mockResolvedValue({ yaml: `kind: Secret\ndata:\n  token: ${FIXTURE_B64}\n` });
      const { getByRole, container } = render(
        <ResourceDetail context="ctx" kind="Secret" namespace="default" name="s-1" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
      await userEvent.click(getByRole("tab", { name: "YAML" }));
      await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("REDACTED"));

      // Shown less, and TOLD so — a silently shortened manifest reads as the
      // real one. `Alert` tone "info" is a `status` region, not an `alert`,
      // so it never collides with the pane's own error state.
      const notice = getByRole("status").textContent ?? "";
      expect(notice.toLowerCase()).toContain("redacted");
      expect(notice).toContain("Details");
    });

    it("shows an error, and never the raw manifest, when a Secret's manifest cannot be redacted", async () => {
      getObject.mockResolvedValue({ object: SECRET });
      // Tabs are not legal YAML indentation — the redactor cannot parse this,
      // and must fail closed rather than pass the input through.
      getManifest.mockResolvedValue({ yaml: `kind: Secret\ndata:\n\ttoken: ${FIXTURE_B64}\n` });
      const { getByRole, container } = render(
        <ResourceDetail context="ctx" kind="Secret" namespace="default" name="s-1" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
      await userEvent.click(getByRole("tab", { name: "YAML" }));
      await waitFor(() => expect(getByRole("alert")).toBeDefined());
      expect(documentContains(FIXTURE_B64)).toBe(false);
      expect(container.querySelector(".cm-content")).toBeNull();
    });

    it("leaves a non-Secret kind's manifest untouched, with no redaction notice", async () => {
      getObject.mockResolvedValue({ object: CONFIGMAP });
      getManifest.mockResolvedValue({ yaml: "kind: ConfigMap\ndata:\n  greeting: hello-world\n" });
      const { getByRole, queryByRole, container } = render(
        <ResourceDetail context="ctx" kind="ConfigMap" namespace="default" name="cm-1" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
      await userEvent.click(getByRole("tab", { name: "YAML" }));
      await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("hello-world"));
      expect(container.querySelector(".cm-content")?.textContent).not.toContain("REDACTED");
      expect(queryByRole("status")).toBeNull();
    });
  });

  it("reports the ambiguity when two CustomResourceDefinitions claim the same kind", async () => {
    // Two groups can legitimately define the same `.kind`. Taking the first
    // match would fetch a manifest from possibly the wrong group and show it
    // as if it were right — a possibly-wrong success, which is worse than a
    // failure.
    getObject.mockResolvedValue({ object: { kind: "Widget", metadata: { name: "w-1", namespace: "default" } } });
    listCrds.mockResolvedValue({
      crds: [
        { name: "widgets.example.com", group: "example.com", version: "v1", kind: "Widget", plural: "widgets", namespaced: true },
        { name: "widgets.other.io", group: "other.io", version: "v1", kind: "Widget", plural: "widgets", namespaced: true },
      ],
    });
    const { getByRole } = render(<ResourceDetail context="ctx" kind="Widget" namespace="default" name="w-1" />);
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getByRole("alert")).toBeDefined());
    const text = getByRole("alert").textContent ?? "";
    expect(text).toContain("Widget");
    expect(text).toContain("example.com");
    expect(text).toContain("other.io");
    // Never guessed at: no manifest is fetched from either group.
    expect(getManifest).not.toHaveBeenCalled();
  });

  it("still resolves a kind claimed by exactly one CustomResourceDefinition among several", async () => {
    getObject.mockResolvedValue({ object: { kind: "Widget", metadata: { name: "w-1", namespace: "default" } } });
    listCrds.mockResolvedValue({
      crds: [
        { name: "gadgets.example.com", group: "example.com", version: "v1", kind: "Gadget", plural: "gadgets", namespaced: true },
        { name: "widgets.other.io", group: "other.io", version: "v2", kind: "Widget", plural: "widgets", namespaced: true },
      ],
    });
    const { getByRole } = render(<ResourceDetail context="ctx" kind="Widget" namespace="default" name="w-1" />);
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(getManifest).toHaveBeenCalledTimes(1));
    expect(getManifest).toHaveBeenCalledWith("ctx", "Widget", "default", "w-1", undefined, {
      group: "other.io",
      version: "v2",
      plural: "widgets",
    });
  });

  /**
   * The mock's third header line — a toned dot, the state, the ready ratio and
   * the age — and the two affordances at its top right.
   */
  describe("the header the design draws", () => {
    it("reads the state, the ready ratio and the age across one line", async () => {
      getObject.mockResolvedValue({ object: DEGRADED_DEPLOYMENT });
      const { getByText, container } = render(
        <ResourceDetail context="ctx" kind="Deployment" namespace="checkout" name="checkout-api" />,
      );
      await waitFor(() => expect(getByText("Degraded")).toBeDefined());
      // Bare figures, each carrying its own noun — the user's call, taken over
      // the kit's own objection (see `Inspector`'s doc comment).
      expect(getByText("9/12 ready")).toBeDefined();
      expect(getByText("84d")).toBeDefined();
      expect(container.querySelector("header")?.textContent).not.toContain("Ready 9/12");
    });

    it("names every bare figure for a reader who cannot see it", async () => {
      getObject.mockResolvedValue({ object: DEGRADED_DEPLOYMENT });
      const { container, getByText } = render(
        <ResourceDetail context="ctx" kind="Deployment" namespace="checkout" name="checkout-api" />,
      );
      await waitFor(() => expect(getByText("Degraded")).toBeDefined());
      // `InspectorFact.label` is never drawn — it is an `sr-only` `dt`. A fact
      // handed a label that merely repeats what the value already says on
      // screen leaves a screen reader with nothing, which is the whole reason
      // the user's bare-figure ruling was survivable.
      const terms = Array.from(container.querySelectorAll("header dt"));
      expect(terms.map((t) => t.textContent)).toEqual(["Progress", "Age"]);
      terms.forEach((t) => expect(t.className).toContain("sr-only"));
    });

    it("draws the age quietly and the ready ratio in normal ink", async () => {
      getObject.mockResolvedValue({ object: DEGRADED_DEPLOYMENT });
      const { getByText } = render(
        <ResourceDetail context="ctx" kind="Deployment" namespace="checkout" name="checkout-api" />,
      );
      await waitFor(() => expect(getByText("Degraded")).toBeDefined());
      expect(getByText("84d").style.color).toBe(toneColor("muted"));
      // A fact defaults to normal ink; only the age is quiet in the mock.
      expect(getByText("9/12 ready").style.color).toBe("");
    });

    it("colours the state and marks the name only when the subject is unhealthy", async () => {
      getObject.mockResolvedValue({ object: DEGRADED_DEPLOYMENT });
      const bad = render(
        <ResourceDetail context="ctx" kind="Deployment" namespace="checkout" name="checkout-api" />,
      );
      await waitFor(() => expect(bad.getByText("Degraded")).toBeDefined());
      expect(bad.container.querySelector("header .status")?.getAttribute("data-bad")).toBe("true");
      // The mock's dot before the NAME. Colour alone says nothing to a
      // colour-blind reader and nothing at all to a screen reader, so the kit
      // pairs it with a word only the latter hears.
      expect(bad.getByText("Needs attention")).toBeDefined();
      bad.unmount();

      getObject.mockResolvedValue({ object: RUNNING_POD });
      const good = render(
        <ResourceDetail context="ctx" kind="Pod" namespace="checkout" name="cart-session-store-0" />,
      );
      // Read off the HEADER's own pill: the Details body below it states the
      // pod's phase as well, so a bare text query finds two "Running"s.
      const headerStatus = () => good.container.querySelector("header .status");
      await waitFor(() => expect(headerStatus()?.textContent).toBe("Running"));
      expect(headerStatus()?.getAttribute("data-bad")).toBeNull();
      expect(good.queryByText("Needs attention")).toBeNull();
      expect(good.getByText("1/1 ready")).toBeDefined();
      expect(good.getByText("211d")).toBeDefined();
    });

    it("draws no status line at all for a kind that has no health of its own", async () => {
      getObject.mockResolvedValue({ object: AGED_CONFIGMAP });
      const { container, getByRole } = render(
        <ResourceDetail context="ctx" kind="ConfigMap" namespace="default" name="cm-1" />,
      );
      await waitFor(() => expect(getByRole("heading", { name: "cm-1" })).toBeDefined());
      // `resourceStatusLine` returning null is an answer, not a gap: a
      // ConfigMap has no health, and half a line — an age with nothing to
      // qualify it — would read as the rest having gone missing.
      expect(container.querySelector("header .status")).toBeNull();
      expect(container.querySelector("header dl")).toBeNull();
    });
  });

  it("orders the panes the way the design does", async () => {
    getObject.mockResolvedValue({ object: RUNNING_POD });
    descriptorFor.mockReturnValue(baseDescriptor({ panes: { containers: true, metrics: true } }));
    const { getAllByRole, getByRole } = render(
      <ResourceDetail context="ctx" kind="Pod" namespace="checkout" name="cart-session-store-0" />,
    );
    await waitFor(() => expect(getByRole("tab", { name: "Metrics" })).toBeDefined());
    // `Details Containers YAML Events Metrics`. Metrics is deferred and no
    // kind's descriptor asks for it yet, so this order only bites the day one
    // does — which is exactly when nobody would think to check it.
    expect(getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Details",
      "Containers",
      "YAML",
      "Events",
      "Metrics",
    ]);
  });

  it("offers Open tab in the peek host only, and leaves the promotion to the host", async () => {
    getObject.mockResolvedValue({ object: POD });
    const onOpenTab = vi.fn();
    const onClose = vi.fn();
    const props = { context: "ctx", kind: "Pod", namespace: "default", name: "web-1" } as const;

    const asPeek = render(<ResourceDetail {...props} peek={{ onClose, onOpenTab }} />);
    await waitFor(() => expect(asPeek.getByRole("tab", { name: "Details" })).toBeDefined());
    await userEvent.click(asPeek.getByRole("button", { name: "Open tab" }));
    expect(onOpenTab).toHaveBeenCalledTimes(1);
    // Promoting is not dismissing: what the peek does with itself afterwards
    // is the host's business, not the pane's.
    expect(onClose).not.toHaveBeenCalled();
    asPeek.unmount();

    // The tab host IS the tab. An Open tab there would open itself.
    const asTab = render(<ResourceDetail {...props} />);
    await waitFor(() => expect(asTab.getByRole("tab", { name: "Details" })).toBeDefined());
    expect(asTab.queryByRole("button", { name: "Open tab" })).toBeNull();
  });

  /**
   * The user's report: the YAML editor took the top third of the pane and the
   * manifest stopped around line 28, with a blank white field beneath it.
   *
   * The cause was the kit's `CodeEditor` default. Left to itself it grows with
   * its content up to `maxHeight` (520px), and 520px of 12px type at a 1.55
   * line height is a little under 28 lines — the very place the manifest was
   * cut. Its wrapper's `h-full` did not save it: `height` and `max-height` are
   * different properties, and the cap wins on the used height.
   */
  describe("the YAML pane's height", () => {
    async function openYaml(kind: string, name: string) {
      const view = render(<ResourceDetail context="ctx" kind={kind} namespace="default" name={name} />);
      await waitFor(() => expect(view.getByRole("tab", { name: "YAML" })).toBeDefined());
      await userEvent.click(view.getByRole("tab", { name: "YAML" }));
      return view;
    }

    it("asks the editor to fill the pane and scroll inside it", async () => {
      getObject.mockResolvedValue({ object: POD });
      const { container } = await openYaml("Pod", "web-1");
      await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());

      expect(codeEditorProps.at(-1)?.fill).toBe(true);
    });

    it("gives that editor a parent with a height to fill", async () => {
      getObject.mockResolvedValue({ object: POD });
      const { container } = await openYaml("Pod", "web-1");
      await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());

      // `fill` resolves to `height: 100%`, which is nothing at all against a
      // parent whose own height is auto. The pane's body is a definite height;
      // this is the chain that carries it down to the editor.
      const host = container.querySelector('[data-slot="yaml-editor"]') as HTMLElement | null;
      expect(host?.className).toContain("h-full");
      const seat = host?.querySelector(".cm-editor")?.parentElement?.parentElement;
      expect(seat?.className).toContain("flex-1");
      expect(seat?.className).toContain("min-h-0");
    });

    it("keeps the Secret redaction notice from taking that height away", async () => {
      getObject.mockResolvedValue({ object: SECRET });
      getManifest.mockResolvedValue({ yaml: `kind: Secret\ndata:\n  token: ${FIXTURE_B64}\n` });
      const { container, getByRole } = await openYaml("Secret", "s-1");
      await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toContain("REDACTED"));

      // The notice is a sibling above the editor, not a block the editor has
      // to grow under: same slot, same seat, one more row in it.
      expect(getByRole("status")).toBeDefined();
      expect(codeEditorProps.at(-1)?.fill).toBe(true);
      const host = container.querySelector('[data-slot="yaml-editor"]') as HTMLElement | null;
      expect(host?.className).toContain("h-full");
      const seat = host?.querySelector(".cm-editor")?.parentElement?.parentElement;
      expect(seat?.className).toContain("flex-1");
      expect(seat?.className).toContain("min-h-0");
    });
  });

  /**
   * The design's footer: a wide `Ask`, the kind's own two actions, and an
   * overflow. The middle pair varies by kind and comes off `KindActions` — no
   * branch on a kind's name lives here — while `Ask` and the overflow are the
   * pane's own shape.
   */
  describe("the footer action bar", () => {
    const podDescriptor = () => baseDescriptor({ actions: { logs: true, shell: true, forward: true, evict: true } });
    const deploymentDescriptor = () =>
      baseDescriptor({ k8sKind: "Deployment", actions: { logs: true, scale: true, restart: true } });

    /** `Inspector` puts it last inside the pane, and nowhere else. */
    const footer = () => document.querySelector("section.pane > footer") as HTMLElement | null;
    const barWords = () => Array.from(footer()?.querySelectorAll("button") ?? []).map((b) => b.textContent);

    it("puts Logs and Edit on a Deployment's bar, behind Ask and before the overflow", async () => {
      getObject.mockResolvedValue({ object: DEGRADED_DEPLOYMENT });
      descriptorFor.mockReturnValue(deploymentDescriptor());
      const { getByRole } = render(
        <ResourceDetail context="ctx" kind="Deployment" namespace="checkout" name="checkout-api" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "Details" })).toBeDefined());

      expect(barWords()).toEqual(["Ask", "Logs", "Edit", "More actions"]);
    });

    it("swaps that Edit for Shell on a Pod, off the descriptor rather than the kind's name", async () => {
      getObject.mockResolvedValue({ object: RUNNING_POD });
      descriptorFor.mockReturnValue(podDescriptor());
      const { getByRole } = render(
        <ResourceDetail context="ctx" kind="Pod" namespace="checkout" name="cart-session-store-0" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "Details" })).toBeDefined());

      expect(barWords()).toEqual(["Ask", "Logs", "Shell", "More actions"]);
    });

    it("asks the console about this very subject, and asks WHY when it is unhealthy", async () => {
      getObject.mockResolvedValue({ object: DEGRADED_DEPLOYMENT });
      descriptorFor.mockReturnValue(deploymentDescriptor());
      const { getByRole } = render(
        <ResourceDetail context="ctx" kind="Deployment" namespace="checkout" name="checkout-api" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "Details" })).toBeDefined());
      await userEvent.click(within(footer()!).getByRole("button", { name: /^Ask/ }));

      // The same phrasing a list row's chip sends — one question per gesture,
      // not two spellings of it.
      expect(asked).toEqual(["Why is checkout-api unhealthy?"]);
    });

    it("asks the other question of a healthy subject", async () => {
      getObject.mockResolvedValue({ object: RUNNING_POD });
      descriptorFor.mockReturnValue(podDescriptor());
      const { getByRole } = render(
        <ResourceDetail context="ctx" kind="Pod" namespace="checkout" name="cart-session-store-0" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "Details" })).toBeDefined());
      await userEvent.click(within(footer()!).getByRole("button", { name: /^Ask/ }));

      expect(asked).toEqual(["What is cart-session-store-0 using right now?"]);
    });

    it("folds the rest behind the overflow, and confirms a destructive one before it runs", async () => {
      getObject.mockResolvedValue({ object: DEGRADED_DEPLOYMENT });
      descriptorFor.mockReturnValue(deploymentDescriptor());
      const { getByRole } = render(
        <ResourceDetail context="ctx" kind="Deployment" namespace="checkout" name="checkout-api" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "Details" })).toBeDefined());
      await userEvent.click(getByRole("button", { name: "More actions" }));

      const menu = await screen.findByRole("dialog");
      expect(Array.from(menu.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
        "Copy as kubectl",
        "Scale",
        "Restart rollout",
        "Delete",
      ]);
      // Marked destructive, not merely present: the same tone the row menu
      // gives the same entries.
      const del = within(menu).getByRole("button", { name: "Delete" });
      expect((del as HTMLElement).style.color).toBe(toneColor("sev"));

      // And it takes a confirm. The pane has to RENDER `useRowMenu`'s dialog,
      // not just its items — a footer wired to the items alone offers Delete
      // and then does nothing at all.
      await userEvent.click(del);
      expect(await screen.findByRole("heading", { name: "Delete Deployment?" })).toBeDefined();
      expect(deleteResource).not.toHaveBeenCalled();
    });

    it("withholds Delete from a custom resource, whose GVK the backend cannot resolve", async () => {
      getObject.mockResolvedValue({ object: { kind: "Widget", metadata: { name: "w-1", namespace: "default" } } });
      // No descriptor is exactly what a kind outside `K8S_KIND` gets, and it is
      // the same verdict `customDescriptor` reaches: Delete would always fail,
      // and an action that cannot work is worse than an absent one.
      descriptorFor.mockReturnValue(undefined);
      const { getByRole, queryByRole } = render(
        <ResourceDetail context="ctx" kind="Widget" namespace="default" name="w-1" />,
      );
      await waitFor(() => expect(getByRole("tab", { name: "Details" })).toBeDefined());

      expect(barWords()).toEqual(["Ask", "Edit", "Copy as kubectl"]);
      // Nothing was left over to fold, so there is no overflow to open onto an
      // empty menu.
      expect(queryByRole("button", { name: "More actions" })).toBeNull();
    });

    it("is the same footer in the peek and in the tab", async () => {
      getObject.mockResolvedValue({ object: RUNNING_POD });
      descriptorFor.mockReturnValue(podDescriptor());
      const props = { context: "ctx", kind: "Pod", namespace: "checkout", name: "cart-session-store-0" } as const;

      const asPeek = render(<ResourceDetail {...props} peek={{ onClose: vi.fn(), onOpenTab: vi.fn() }} />);
      await waitFor(() => expect(asPeek.getByRole("tab", { name: "Details" })).toBeDefined());
      const inPeek = barWords();
      expect(inPeek).toEqual(["Ask", "Logs", "Shell", "More actions"]);
      asPeek.unmount();

      const asTab = render(<ResourceDetail {...props} />);
      await waitFor(() => expect(asTab.getByRole("tab", { name: "Details" })).toBeDefined());
      // R-5: one pane, two hosts. The footer is not one of the things `peek`
      // is allowed to vary.
      expect(barWords()).toEqual(inPeek);
    });
  });
});
