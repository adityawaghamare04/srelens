import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLayoutEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CrdRef, EventSummary, K8sObject } from "@srelens/core";
import type { KindDescriptor, ListRow } from "../../lib/kinds/types";

// `useObject` reads `getObject`; the YAML and Events panes read `getManifest`
// and `listEvents` directly, and the YAML pane also reads `listCrds` to
// resolve a custom resource's group/version/plural before fetching its
// manifest. All four are core's, mocked here so a test controls what "the
// cluster said" without one — `importOriginal` keeps everything else
// (K8S_KIND, and the real types) intact.
const { getObject, getManifest, listEvents, listCrds } = vi.hoisted(() => ({
  getObject: vi.fn(async (): Promise<{ object?: K8sObject; error?: string }> => ({})),
  getManifest: vi.fn(async (): Promise<{ yaml?: string; error?: string }> => ({ yaml: "" })),
  listEvents: vi.fn(async (): Promise<{ events?: EventSummary[]; error?: string }> => ({ events: [] })),
  listCrds: vi.fn(async (): Promise<{ crds?: CrdRef[]; error?: string }> => ({ crds: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  getObject,
  getManifest,
  listEvents,
  listCrds,
}));

// The shell asks the same descriptor the list screen resolves, only to read
// `panes` off it — mocked so a test can hand it a kind with or without
// Containers/Metrics without depending on which real kinds have that set.
const { descriptorFor } = vi.hoisted(() => ({
  descriptorFor: vi.fn((_slug: string): KindDescriptor<ListRow> | undefined => undefined),
}));

vi.mock("../../lib/kinds/descriptors", () => ({ descriptorFor }));

import { ResourceDetail } from "./ResourceDetail";

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

  it("behaves identically with and without onClose, apart from the close affordance", async () => {
    getObject.mockResolvedValue({ object: POD });
    const props = { context: "ctx", kind: "Pod", namespace: "default", name: "web-1" } as const;

    const withClose = render(<ResourceDetail {...props} onClose={vi.fn()} />);
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
});
