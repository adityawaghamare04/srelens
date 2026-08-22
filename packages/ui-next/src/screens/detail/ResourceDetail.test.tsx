import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
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

  it("does not refetch the object when switching panes", async () => {
    getObject.mockResolvedValue({ object: POD });
    const { getByRole } = render(<ResourceDetail context="ctx" kind="Pod" namespace="default" name="web-1" />);
    await waitFor(() => expect(getByRole("tab", { name: "YAML" })).toBeDefined());
    expect(getObject).toHaveBeenCalledTimes(1);

    await userEvent.click(getByRole("tab", { name: "YAML" }));
    await userEvent.click(getByRole("tab", { name: "Events" }));
    await userEvent.click(getByRole("tab", { name: "Details" }));

    expect(getObject).toHaveBeenCalledTimes(1);
  });

  it("behaves identically with and without onClose, apart from the close affordance", async () => {
    getObject.mockResolvedValue({ object: POD });
    const props = { context: "ctx", kind: "Pod", namespace: "default", name: "web-1" } as const;

    const withClose = render(<ResourceDetail {...props} onClose={vi.fn()} />);
    await waitFor(() => expect(withClose.getByRole("tab", { name: "YAML" })).toBeDefined());
    expect(withClose.getByRole("button", { name: "Close inspector" })).toBeDefined();
    const tabsWithClose = withClose.getAllByRole("tab").map((t) => t.textContent);
    const headingWithClose = withClose.getByRole("heading").textContent;
    withClose.unmount();

    const withoutClose = render(<ResourceDetail {...props} />);
    await waitFor(() => expect(withoutClose.getByRole("tab", { name: "YAML" })).toBeDefined());
    expect(withoutClose.queryByRole("button", { name: "Close inspector" })).toBeNull();
    expect(withoutClose.getAllByRole("tab").map((t) => t.textContent)).toEqual(tabsWithClose);
    expect(withoutClose.getByRole("heading").textContent).toEqual(headingWithClose);
  });
});
