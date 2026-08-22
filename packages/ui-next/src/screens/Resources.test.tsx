import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Everything the screen reaches into core for. `watchResource` is held open by
// the test rather than resolved once: half of what this screen does is react to
// a stream that keeps arriving, and a mock that only answers the first call
// cannot say anything about the second snapshot or a dropped connection.
const {
  watchResource,
  listCrds,
  listCustomResource,
  listNodes,
  nodeMetrics,
  podMetrics,
  useNamespaceOptions,
} = vi.hoisted(() => ({
  watchResource: vi.fn(),
  listCrds: vi.fn(),
  listCustomResource: vi.fn(),
  listNodes: vi.fn(),
  nodeMetrics: vi.fn(),
  podMetrics: vi.fn(),
  useNamespaceOptions: vi.fn(),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  watchResource: (...a: unknown[]) => watchResource(...a),
  listCrds: (...a: unknown[]) => listCrds(...a),
  listCustomResource: (...a: unknown[]) => listCustomResource(...a),
  listNodes: (...a: unknown[]) => listNodes(...a),
  nodeMetrics: (...a: unknown[]) => nodeMetrics(...a),
  podMetrics: (...a: unknown[]) => podMetrics(...a),
}));

vi.mock("@srelens/core/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core/react")>()),
  useNamespaceOptions: (...a: unknown[]) => useNamespaceOptions(...a),
}));

// jsdom has neither, and both pickers on this screen are Radix popovers.
// Inert stubs: jsdom does no layout, so there is never a resize to report.
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

import type { ClusterContext, CrdRef } from "@srelens/core";
import { Resources } from "./Resources";
import * as store from "../lib/tabsStore";
import { defaultState } from "../lib/tabs";
import { resetContexts, setContexts, setKubeconfigFiles } from "../lib/clusters";
import { hiddenColumns, loadColumnPrefs } from "../lib/columnPrefs";
import { resetListCache } from "../lib/resourceList";
import { getView, resetView } from "../lib/workspace";

const CTX: ClusterContext = {
  name: "prod-eu",
  stableId: "prod",
  cluster: "prod",
  server: "https://prod",
  isCurrent: true,
};

const PODS = [
  { name: "web-1", namespace: "default", ready: "1/1", phase: "Running", restarts: 3, node: "n1", age: "2d" },
  { name: "api-7", namespace: "billing", ready: "1/1", phase: "Running", restarts: 1, node: "n2", age: "5d" },
];

const WIDGETS: CrdRef = {
  name: "widgets.example.com",
  group: "example.com",
  version: "v1",
  kind: "Widget",
  plural: "widgets",
  namespaced: true,
  printerColumns: [{ name: "Phase", jsonPath: ".status.phase", type: "string" }],
};

/** The live watch: what the screen was handed, so a test can push into it. */
let stream: {
  rows: (rows: unknown[]) => void;
  status: (status: "live" | "reconnecting") => void;
  error: (message: string) => void;
};
let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  stop = vi.fn();
  watchResource.mockImplementation(
    async (
      _context: string,
      _namespace: string,
      _kind: string,
      onRows: (rows: unknown[]) => void,
      onStatus: (status: "live" | "reconnecting") => void,
      onError: (message: string) => void,
    ) => {
      stream = { rows: onRows, status: onStatus, error: onError };
      onRows(PODS);
      return { stop };
    },
  );
  listCrds.mockResolvedValue({ crds: [] });
  listCustomResource.mockResolvedValue({ items: [] });
  listNodes.mockResolvedValue({ nodes: [] });
  nodeMetrics.mockResolvedValue({ metrics: [] });
  podMetrics.mockResolvedValue({ metrics: [] });
  useNamespaceOptions.mockReturnValue({ namespaces: ["default", "billing"], scope: "", error: "" });

  resetContexts();
  setContexts([CTX]);
  setKubeconfigFiles(["/home/u/.kube/config"]);
  store.setState(defaultState([CTX]));
  resetView();
  resetListCache();
  // The preferences are module state that outlives a test; localStorage is
  // cleared by the shared setup, so re-reading it is a reset.
  loadColumnPrefs();
});

/** The first cell of every rendered row, in the order they are on screen. */
const rowNames = () =>
  Array.from(document.querySelectorAll("tbody tr.tbl-row td:first-child")).map((td) => td.textContent);

const headers = () =>
  Array.from(document.querySelectorAll("thead th .th-sort span")).map((el) => el.textContent);

const activeTab = () => {
  const w = store.currentWorkspace();
  return w.tabs.find((t) => t.id === w.activeId)!;
};

/** Open the column picker and hand back its panel. */
async function openColumns() {
  await userEvent.click(screen.getByRole("button", { name: /Columns/ }));
  return screen.findByRole("group");
}

describe("Resources", () => {
  it("lists a kind's rows under its own title", async () => {
    render(<Resources route="/k/pods" />);

    expect(await screen.findByRole("heading", { level: 1, name: "Pods" })).toBeTruthy();
    await waitFor(() => expect(rowNames()).toEqual(["web-1", "api-7"]));
    // The screen names no kind: the watch is opened on the route's slug.
    expect(watchResource.mock.calls[0][0]).toBe("prod-eu");
    expect(watchResource.mock.calls[0][2]).toBe("pods");
  });

  it("lists a custom resource this cluster has, from its own printer columns", async () => {
    listCrds.mockResolvedValue({ crds: [WIDGETS] });
    listCustomResource.mockResolvedValue({
      items: [{ name: "left", namespace: "default", age: "1d", columns: ["Ready"] }],
    });

    render(<Resources route="/k/widgets.example.com" />);

    await waitFor(() => expect(rowNames()).toEqual(["left"]));
    expect(headers()).toContain("Phase");
    expect(listCrds).toHaveBeenCalledWith("prod-eu");
  });

  it("narrows the list by the filter text", async () => {
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    await userEvent.type(screen.getByRole("searchbox", { name: "Filter pods" }), "web");

    await waitFor(() => expect(rowNames()).toEqual(["web-1"]));
  });

  it("reorders by a sortable column when its header is activated", async () => {
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(rowNames()).toEqual(["web-1", "api-7"]));

    await userEvent.click(screen.getByRole("button", { name: "Sort by Restarts" }));

    await waitFor(() => expect(rowNames()).toEqual(["api-7", "web-1"]));
  });

  it("keeps a tab's sort and filter where a restart will find them", async () => {
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    await userEvent.click(screen.getByRole("button", { name: "Sort by Restarts" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter pods" }), "web");

    // Component state alone would pass the two assertions above and lose both
    // values on the next launch — the tab is what gets written to disk.
    expect(activeTab().view).toMatchObject({
      sort: { key: "restarts", direction: "asc" },
      filter: "web",
    });
  });

  it("hides a column the picker unchecks, and remembers it for that kind", async () => {
    const view = render(<Resources route="/k/pods" />);
    await waitFor(() => expect(headers()).toContain("Restarts"));

    await openColumns();
    await userEvent.click(screen.getByRole("checkbox", { name: "Restarts" }));

    await waitFor(() => expect(headers()).not.toContain("Restarts"));
    expect([...hiddenColumns("pods")]).toEqual(["restarts"]);

    // Remembered for the kind rather than for this mounting of the screen.
    view.unmount();
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(headers()).toContain("Status"));
    expect(headers()).not.toContain("Restarts");
  });

  it("clears a filter that was on a column the user just hid", async () => {
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(headers()).toContain("Restarts"));

    await userEvent.click(screen.getByRole("button", { name: "Filter search by Restarts" }));
    await waitFor(() => expect(activeTab().view?.filterKey).toBe("restarts"));

    await openColumns();
    await userEvent.click(screen.getByRole("checkbox", { name: "Restarts" }));

    // The classic bug: the column goes, the filter key stays, and the search
    // box quietly matches nothing for the rest of the session.
    await waitFor(() => expect(activeTab().view?.filterKey).toBeNull());
  });

  it("shows no namespace picker for a cluster-scoped kind", async () => {
    listNodes.mockResolvedValue({ nodes: [{ name: "n1", status: "Ready", roles: "worker", version: "1.30", age: "9d", taints: 0 }] });

    render(<Resources route="/k/nodes" />);

    await waitFor(() => expect(rowNames()).toEqual(["n1"]));
    // Absent, not disabled.
    expect(screen.queryByRole("combobox", { name: "Namespaces" })).toBeNull();
    expect(headers()).not.toContain("Namespace");
  });

  it("offers the namespace picker for a namespaced kind", async () => {
    render(<Resources route="/k/pods" />);

    expect(await screen.findByRole("combobox", { name: "Namespaces" })).toBeTruthy();
  });

  it("follows the namespace a restricted credential is scoped to", async () => {
    useNamespaceOptions.mockReturnValue({ namespaces: ["team-a"], scope: "team-a", error: "" });

    render(<Resources route="/k/pods" />);

    // Written to the workspace store, so every screen on this cluster follows.
    await waitFor(() => expect(getView().namespaces.prod).toEqual(["team-a"]));
    await waitFor(() =>
      expect(watchResource.mock.calls.some((call) => call[1] === "team-a")).toBe(true),
    );
  });

  it("says the kind has none, distinctly from the filter matching none", async () => {
    watchResource.mockImplementation(
      async (_c: string, _n: string, _k: string, onRows: (rows: unknown[]) => void) => {
        onRows([]);
        return { stop };
      },
    );
    const view = render(<Resources route="/k/pods" />);
    expect(await screen.findByText("No pods")).toBeTruthy();
    view.unmount();

    watchResource.mockImplementation(
      async (_c: string, _n: string, _k: string, onRows: (rows: unknown[]) => void) => {
        onRows(PODS);
        return { stop };
      },
    );
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter pods" }), "zzz");

    // The second is the user's own doing, and says so.
    expect(await screen.findByText("No pods match this filter")).toBeTruthy();
    expect(screen.queryByText("No pods")).toBeNull();
  });

  it("says the cluster list could not be read rather than showing an empty table", async () => {
    watchResource.mockImplementation(
      async (
        _c: string,
        _n: string,
        _k: string,
        _onRows: unknown,
        _onStatus: unknown,
        onError: (message: string) => void,
      ) => {
        onError("pods is forbidden");
        return { stop };
      },
    );

    render(<Resources route="/k/pods" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("pods is forbidden");
    expect(document.querySelector("table")).toBeNull();
  });

  it("keeps the rows on screen and calls them stale when the list stops refreshing", async () => {
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    act(() => stream.error("connection reset"));

    // An error with rows behind it must not empty the table.
    await waitFor(() => expect(screen.getByText(/stale/i)).toBeTruthy());
    expect(rowNames()).toEqual(["web-1", "api-7"]);
  });

  it("shows the rows and says the stream dropped when the watch is reconnecting", async () => {
    render(<Resources route="/k/pods" />);
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    expect(screen.getByText("Live")).toBeTruthy();

    act(() => stream.status("reconnecting"));

    expect(await screen.findByText("Stream lost")).toBeTruthy();
    expect(rowNames()).toEqual(["web-1", "api-7"]);
  });

  it("names an unknown slug rather than rendering a blank table", async () => {
    // A route string can arrive from a session persisted against a cluster
    // that has since lost the operator.
    render(<Resources route="/k/nonsuch.example.com" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nonsuch.example.com");
    expect(document.querySelector("table")).toBeNull();
  });

  it("renders nothing but a prompt when the workspace has no active cluster", async () => {
    setContexts([]);
    store.setState(defaultState([]));

    render(<Resources route="/k/pods" />);

    expect(screen.getByText(/pick a cluster/i)).toBeTruthy();
    // Not one call into core: there is no context name to make one with.
    expect(watchResource).not.toHaveBeenCalled();
    expect(listCrds).not.toHaveBeenCalled();
    expect(useNamespaceOptions).not.toHaveBeenCalled();
  });
});
