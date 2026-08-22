import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  deleteResource,
} = vi.hoisted(() => ({
  watchResource: vi.fn(),
  listCrds: vi.fn(),
  listCustomResource: vi.fn(),
  listNodes: vi.fn(),
  nodeMetrics: vi.fn(),
  podMetrics: vi.fn(),
  useNamespaceOptions: vi.fn(),
  deleteResource: vi.fn(async (): Promise<{ ok?: boolean; error?: string }> => ({ ok: true })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  watchResource: (...a: unknown[]) => watchResource(...a),
  listCrds: (...a: unknown[]) => listCrds(...a),
  listCustomResource: (...a: unknown[]) => listCustomResource(...a),
  listNodes: (...a: unknown[]) => listNodes(...a),
  nodeMetrics: (...a: unknown[]) => nodeMetrics(...a),
  podMetrics: (...a: unknown[]) => podMetrics(...a),
  deleteResource,
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
import { ConsoleProvider, useConsole } from "../console";
import * as store from "../lib/tabsStore";
import { defaultState } from "../lib/tabs";
import { resetContexts, setContexts, setKubeconfigFiles } from "../lib/clusters";
import { hiddenColumns, loadColumnPrefs, toggleColumn } from "../lib/columnPrefs";
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
  asked = [];
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

/**
 * The name cell of every rendered row, in the order they are on screen.
 *
 * Not `td:first-child`: `Table`'s optional bulk-selection checkbox (wired in
 * this screen since the bulk action bar landed) is a real leading `<td
 * class="tbl-check">`, so the first *child* is the checkbox whenever a
 * selection is active and the name only holds `:nth-child(2)` by accident of
 * today's column order. Skipping `.tbl-check` instead reads the first *data*
 * cell whether or not the checkbox column is there, and keeps reading the
 * name correctly if a future column is ever added or removed ahead of it.
 */
const rowNames = () =>
  Array.from(document.querySelectorAll("tbody tr.tbl-row")).map(
    (row) => row.querySelector("td:not(.tbl-check)")?.textContent ?? null,
  );

const headers = () =>
  Array.from(document.querySelectorAll("thead th .th-sort span")).map((el) => el.textContent);

/** The tab a route is open in — the one the screen under test is bound to. */
const tabFor = (route: string) => store.currentWorkspace().tabs.find((t) => t.route === route)!;

/** Every question a row's ask chip has sent to the console, in order asked. */
let asked: string[];

/** Stands in for the dock: registers as the console's listener, the way
 *  `ConsoleDock` does, and records what arrives instead of rendering it. */
function AskPeek() {
  const { registerSubmit } = useConsole();
  useEffect(() => registerSubmit((question) => asked.push(question)), [registerSubmit]);
  return null;
}

/**
 * Open the route in a tab, then render its screen — the way `Window` does it.
 * The screen reads its sort and filter off its own tab, so a screen rendered
 * against a route no tab holds would have nowhere to put them. Wrapped in the
 * same `ConsoleProvider` the real shell mounts at the root, since a row's ask
 * chip now reaches `useConsole()`.
 */
function open(route: string) {
  store.openTab(route);
  return render(
    <ConsoleProvider>
      <Resources route={route} />
      <AskPeek />
    </ConsoleProvider>,
  );
}

/** Open the column picker and hand back its panel. */
async function openColumns() {
  await userEvent.click(screen.getByRole("button", { name: /Columns/ }));
  return screen.findByRole("group");
}

describe("Resources", () => {
  it("lists a kind's rows under its own title", async () => {
    open("/k/pods");

    expect(await screen.findByRole("heading", { level: 1, name: "Pods" })).toBeTruthy();
    await waitFor(() => expect(rowNames()).toEqual(["web-1", "api-7"]));
    // The screen names no kind: the watch is opened on the route's slug.
    expect(watchResource.mock.calls[0][0]).toBe("prod-eu");
    expect(watchResource.mock.calls[0][2]).toBe("pods");
  });

  // Correction 1: the design mock titles every kind's identifier column
  // "Name" — never "Pod", "Deployment", "Secret". Classic named it by kind.
  it("titles the identifier column Name, not the kind", async () => {
    open("/k/pods");

    await waitFor(() => expect(headers()).toContain("Name"));
    expect(headers()).not.toContain("Pod");
  });

  // Correction 3: an unhealthy row gets a dot before its name, and the dot is
  // never colour alone — a reason rides beside it for anyone who cannot see
  // the colour, the same contract the cluster rail's `unavailable` follows.
  it("marks an unhealthy pod's row with a dot that also says so in words", async () => {
    watchResource.mockImplementation(
      async (_c: string, _n: string, _k: string, onRows: (rows: unknown[]) => void) => {
        onRows([
          { name: "web-1", namespace: "default", ready: "1/1", phase: "Running", restarts: 0, node: "n1", age: "2d" },
          { name: "bad-1", namespace: "default", ready: "0/1", phase: "CrashLoopBackOff", restarts: 9, node: "n1", age: "2d" },
        ]);
        return { stop };
      },
    );
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    const badRow = within(screen.getByText("bad-1").closest("tr")!);
    expect(badRow.getByText(/needs attention/i)).toBeTruthy();

    const goodRow = within(screen.getByText("web-1").closest("tr")!);
    expect(goodRow.queryByText(/needs attention/i)).toBeNull();
  });

  // Correction 3: every row gets a trailing ask chip that hands the row to
  // the console dock, naming the actual resource and its state — "Why is X
  // unhealthy?" for a bad row, a resource-use question otherwise.
  it("offers an ask chip on each row that names the resource and its state", async () => {
    watchResource.mockImplementation(
      async (_c: string, _n: string, _k: string, onRows: (rows: unknown[]) => void) => {
        onRows([
          { name: "web-1", namespace: "default", ready: "1/1", phase: "Running", restarts: 0, node: "n1", age: "2d" },
          { name: "bad-1", namespace: "default", ready: "0/1", phase: "CrashLoopBackOff", restarts: 9, node: "n1", age: "2d" },
        ]);
        return { stop };
      },
    );
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    const badRow = within(screen.getByText("bad-1").closest("tr")!);
    await userEvent.click(badRow.getByRole("button", { name: /Why is bad-1 unhealthy\?/ }));
    expect(asked).toEqual(["Why is bad-1 unhealthy?"]);

    const goodRow = within(screen.getByText("web-1").closest("tr")!);
    await userEvent.click(goodRow.getByRole("button", { name: /web-1/ }));
    expect(asked[1]).toMatch(/web-1/);
    expect(asked[1]).not.toMatch(/unhealthy/i);
  });

  it("lists a custom resource this cluster has, from its own printer columns", async () => {
    listCrds.mockResolvedValue({ crds: [WIDGETS] });
    listCustomResource.mockResolvedValue({
      items: [{ name: "left", namespace: "default", age: "1d", columns: ["Ready"] }],
    });

    open("/k/widgets.example.com");

    await waitFor(() => expect(rowNames()).toEqual(["left"]));
    expect(headers()).toContain("Phase");
    expect(listCrds).toHaveBeenCalledWith("prod-eu");
  });

  it("narrows the list by the filter text", async () => {
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    await userEvent.type(screen.getByRole("searchbox", { name: "Filter pods" }), "web");

    await waitFor(() => expect(rowNames()).toEqual(["web-1"]));
  });

  it("reorders by a sortable column when its header is activated", async () => {
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toEqual(["web-1", "api-7"]));

    await userEvent.click(screen.getByRole("button", { name: "Sort by Restarts" }));

    await waitFor(() => expect(rowNames()).toEqual(["api-7", "web-1"]));
  });

  it("keeps a tab's sort and filter where a restart will find them", async () => {
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    await userEvent.click(screen.getByRole("button", { name: "Sort by Restarts" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter pods" }), "web");

    // Component state alone would pass the two assertions above and lose both
    // values on the next launch — the tab is what gets written to disk.
    expect(tabFor("/k/pods").view).toMatchObject({
      sort: { key: "restarts", direction: "asc" },
      filter: "web",
    });
  });

  it("hides a column the picker unchecks, and remembers it for that kind", async () => {
    const view = open("/k/pods");
    await waitFor(() => expect(headers()).toContain("Restarts"));

    await openColumns();
    await userEvent.click(screen.getByRole("checkbox", { name: "Restarts" }));

    await waitFor(() => expect(headers()).not.toContain("Restarts"));
    expect([...hiddenColumns("pods")]).toEqual(["restarts"]);

    // Remembered for the kind rather than for this mounting of the screen.
    view.unmount();
    open("/k/pods");
    await waitFor(() => expect(headers()).toContain("Status"));
    expect(headers()).not.toContain("Restarts");
  });

  it("clears a filter that was on a column the user just hid", async () => {
    open("/k/pods");
    await waitFor(() => expect(headers()).toContain("Restarts"));

    // Set through the store rather than the column header's own funnel: the
    // design mock has one search box and no per-column funnels, so the
    // columns this screen hands `Table` no longer ask for one (#324) — the
    // key can still arrive here the way a restored tab would carry it in.
    act(() => store.setTabView(tabFor("/k/pods").id, { filterKey: "restarts" }));
    await waitFor(() => expect(tabFor("/k/pods").view?.filterKey).toBe("restarts"));

    await openColumns();
    await userEvent.click(screen.getByRole("checkbox", { name: "Restarts" }));

    // The classic bug: the column goes, the filter key stays, and the search
    // box quietly matches nothing for the rest of the session.
    await waitFor(() => expect(tabFor("/k/pods").view?.filterKey).toBeNull());
  });

  it("ignores a filter key naming a column another tab hid", async () => {
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    // A key this tab has carried since a previous launch.
    act(() => store.setTabView(tabFor("/k/pods").id, { filterKey: "restarts", filter: "web" }));
    await waitFor(() => expect(rowNames()).toHaveLength(0));

    // Hidden columns belong to the kind, not to this tab: another tab — in
    // another workspace, while this screen was not mounted — can hide the
    // column this tab's filter key names, so clearing the key on the toggle
    // is not enough. Hidden here through the store, never through this
    // screen's own picker.
    act(() => toggleColumn("pods", "restarts"));

    // Pointed at a column that is not there, `filterTableData` has nothing to
    // search and quietly returns every row. Derived, the key falls away and
    // the text searches the columns that are actually on screen.
    await waitFor(() => expect(rowNames()).toEqual(["web-1"]));
  });

  it("keeps each tab's view to itself when several are mounted", async () => {
    // `Window` mounts every tab's body and only hides the inactive ones.
    listNodes.mockResolvedValue({
      nodes: [{ name: "n1", status: "Ready", roles: "worker", version: "1.30", age: "9d", taints: 0 }],
    });
    store.openTab("/k/pods");
    store.openTab("/k/nodes"); // the active one
    render(
      <ConsoleProvider>
        <Resources route="/k/pods" />
        <Resources route="/k/nodes" />
      </ConsoleProvider>,
    );
    await screen.findByRole("searchbox", { name: "Filter pods" });

    await userEvent.type(screen.getByRole("searchbox", { name: "Filter pods" }), "web");

    expect(tabFor("/k/pods").view).toMatchObject({ filter: "web" });
    // Reading the *active* tab would have written the filter here instead, and
    // re-filtered a list the user is not even looking at on every keystroke.
    expect(tabFor("/k/nodes").view).toBeUndefined();
  });

  it("shows no namespace picker for a cluster-scoped kind", async () => {
    listNodes.mockResolvedValue({ nodes: [{ name: "n1", status: "Ready", roles: "worker", version: "1.30", age: "9d", taints: 0 }] });

    open("/k/nodes");

    await waitFor(() => expect(rowNames()).toEqual(["n1"]));
    // Absent, not disabled.
    expect(screen.queryByRole("combobox", { name: "Namespaces" })).toBeNull();
    expect(headers()).not.toContain("Namespace");
  });

  it("offers the namespace picker for a namespaced kind", async () => {
    open("/k/pods");

    expect(await screen.findByRole("combobox", { name: "Namespaces" })).toBeTruthy();
  });

  it("follows the namespace a restricted credential is scoped to", async () => {
    useNamespaceOptions.mockReturnValue({ namespaces: ["team-a"], scope: "team-a", error: "" });

    open("/k/pods");

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
    const view = open("/k/pods");
    expect(await screen.findByText("No pods")).toBeTruthy();
    view.unmount();

    watchResource.mockImplementation(
      async (_c: string, _n: string, _k: string, onRows: (rows: unknown[]) => void) => {
        onRows(PODS);
        return { stop };
      },
    );
    open("/k/pods");
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

    open("/k/pods");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("pods is forbidden");
    expect(document.querySelector("table")).toBeNull();
  });

  it("keeps the rows on screen and calls them stale when the list stops refreshing", async () => {
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toHaveLength(2));

    act(() => stream.error("connection reset"));

    // An error with rows behind it must not empty the table.
    await waitFor(() => expect(screen.getByText(/stale/i)).toBeTruthy());
    expect(rowNames()).toEqual(["web-1", "api-7"]);
  });

  it("shows the rows and says the stream dropped when the watch is reconnecting", async () => {
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    expect(screen.getByText("Live")).toBeTruthy();

    act(() => stream.status("reconnecting"));

    expect(await screen.findByText("Stream lost")).toBeTruthy();
    expect(rowNames()).toEqual(["web-1", "api-7"]);
  });

  it("names an unknown slug rather than rendering a blank table", async () => {
    // A route string can arrive from a session persisted against a cluster
    // that has since lost the operator.
    open("/k/nonsuch.example.com");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("nonsuch.example.com");
    expect(document.querySelector("table")).toBeNull();
  });

  it("renders nothing but a prompt when the workspace has no active cluster", async () => {
    setContexts([]);
    store.setState(defaultState([]));

    open("/k/pods");

    expect(screen.getByText(/pick a cluster/i)).toBeTruthy();
    // Not one call into core: there is no context name to make one with.
    expect(watchResource).not.toHaveBeenCalled();
    expect(listCrds).not.toHaveBeenCalled();
    expect(useNamespaceOptions).not.toHaveBeenCalled();
  });

  // The seam between this screen and `useRowMenu` (`ResourceMenu.tsx`): the
  // hook itself is tested on its own contract in `ResourceMenu.test.tsx`,
  // but nothing there renders `Resources` — this is what proves `rowMenu`,
  // `rowMenuLabel` and the dialog are actually wired to the table this
  // screen renders, not merely both present in the file.
  it("opens a row's menu and its confirm dialog from the rendered screen", async () => {
    open("/k/pods");
    await waitFor(() => expect(rowNames()).toEqual(["web-1", "api-7"]));

    fireEvent.contextMenu(screen.getByText("web-1").closest("tr")!);
    await userEvent.click(await screen.findByText("Delete"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("web-1");
  });

  // The property that matters most for the bulk action bar: an all-namespaces
  // view can hold two same-named resources, and only the one actually checked
  // may be written to. This goes through the real rendered `Table` — its own
  // checkbox, named from its own namespace-qualified row key — rather than a
  // hand-built selection, so it proves the wiring in this screen, not just
  // `ResourceBulk`'s own contract (which `ResourceBulk.test.tsx` covers with
  // constructed keys).
  it("deletes only the checked row when two selected candidates share a name across namespaces", async () => {
    watchResource.mockImplementation(
      async (_c: string, _n: string, _k: string, onRows: (rows: unknown[]) => void) => {
        onRows([
          { name: "web-0", namespace: "default", ready: "1/1", phase: "Running", restarts: 0, node: "n1", age: "1d" },
          { name: "web-0", namespace: "billing", ready: "1/1", phase: "Running", restarts: 0, node: "n2", age: "1d" },
        ]);
        return { stop };
      },
    );

    open("/k/pods");
    await waitFor(() => expect(rowNames()).toEqual(["web-0", "web-0"]));

    // Check only the billing one. The two rows render identical name text —
    // the checkbox is the only thing on screen that disambiguates them.
    await userEvent.click(screen.getByRole("checkbox", { name: "Select billing/web-0" }));

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteResource).toHaveBeenCalledTimes(1));
    expect(deleteResource).toHaveBeenCalledWith("prod-eu", "Pod", "billing", "web-0");
  });
});
