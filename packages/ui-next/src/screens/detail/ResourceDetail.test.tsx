import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLayoutEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { EventSummary, K8sObject } from "@srelens/core";
import type { KindDescriptor, ListRow } from "../../lib/kinds/types";

// `useObject` reads `getObject`; the YAML and Events panes read `getManifest`
// and `listEvents` directly. All three are core's, mocked here so a test
// controls what "the cluster said" without one — `importOriginal` keeps
// everything else (K8S_KIND, and the real types) intact.
const { getObject, getManifest, listEvents } = vi.hoisted(() => ({
  getObject: vi.fn(async (): Promise<{ object?: K8sObject; error?: string }> => ({})),
  getManifest: vi.fn(async (): Promise<{ yaml?: string; error?: string }> => ({ yaml: "" })),
  listEvents: vi.fn(async (): Promise<{ events?: EventSummary[]; error?: string }> => ({ events: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  getObject,
  getManifest,
  listEvents,
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

function baseDescriptor(overrides: Partial<KindDescriptor<ListRow>> = {}): KindDescriptor<ListRow> {
  return { k8sKind: "Pod", columns: [], source: "watch", scope: "namespaced", actions: {}, ...overrides };
}

describe("ResourceDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getManifest.mockResolvedValue({ yaml: "kind: Pod\n" });
    listEvents.mockResolvedValue({ events: [] });
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
});
