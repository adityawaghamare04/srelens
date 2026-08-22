import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { watchResource, useNamespaceOptions, cronjobSetSuspend } = vi.hoisted(() => ({
  watchResource: vi.fn(),
  useNamespaceOptions: vi.fn(),
  cronjobSetSuspend: vi.fn(),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  watchResource: (...a: unknown[]) => watchResource(...a),
  cronjobSetSuspend: (...a: unknown[]) => cronjobSetSuspend(...a),
}));

vi.mock("@srelens/core/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core/react")>()),
  useNamespaceOptions: (...a: unknown[]) => useNamespaceOptions(...a),
}));

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

import type { ClusterContext } from "@srelens/core";
import { Workloads } from "./Workloads";
import { ConsoleProvider } from "../console";
import * as store from "../lib/tabsStore";
import { defaultState } from "../lib/tabs";
import { resetContexts, setContexts, setKubeconfigFiles } from "../lib/clusters";
import { loadColumnPrefs } from "../lib/columnPrefs";
import { resetListCache } from "../lib/resourceList";
import { resetView } from "../lib/workspace";

const CTX: ClusterContext = {
  name: "prod-eu",
  stableId: "prod",
  cluster: "prod",
  server: "https://prod",
  isCurrent: true,
};

// One row per kind, deliberately with ages that interleave across kinds
// rather than falling neatly kind-by-kind — the fixture the cross-kind sort
// test depends on.
const DEPLOYMENTS = [
  { name: "checkout", namespace: "default", ready: "2/2", upToDate: 2, available: 2, age: "10d" },
];
const STATEFULSETS = [
  { name: "db", namespace: "default", ready: "1/1", updated: 1, service: "db-svc", age: "30d" },
];
const DAEMONSETS = [
  { name: "node-exporter", namespace: "kube-system", desired: 3, current: 3, ready: 3, upToDate: 3, available: 3, age: "1d" },
];
const PODS = [
  { name: "web-1", namespace: "default", phase: "Running", ready: "1/1", restarts: 0, node: "n1", age: "2d", image: "acme/web:1" },
];
const CRONJOBS = [
  { name: "nightly-backup", namespace: "default", schedule: "0 2 * * *", suspended: false, active: 0, lastSchedule: "2h ago", age: "120d" },
];

const FIXTURES: Record<string, unknown[]> = {
  deployments: DEPLOYMENTS,
  statefulsets: STATEFULSETS,
  daemonsets: DAEMONSETS,
  pods: PODS,
  cronjobs: CRONJOBS,
};

let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  stop = vi.fn();
  watchResource.mockImplementation(
    async (
      _context: string,
      _namespace: string,
      kind: string,
      onRows: (rows: unknown[]) => void,
    ) => {
      onRows(FIXTURES[kind] ?? []);
      return { stop };
    },
  );
  useNamespaceOptions.mockReturnValue({ namespaces: ["default", "kube-system"], scope: "", error: "" });
  cronjobSetSuspend.mockResolvedValue({ ok: true });

  resetContexts();
  setContexts([CTX]);
  setKubeconfigFiles(["/home/u/.kube/config"]);
  store.setState(defaultState([CTX]));
  resetView();
  resetListCache();
  loadColumnPrefs();
});

/** The name cell of every rendered row, in table order. */
const rowNames = () =>
  Array.from(document.querySelectorAll("tbody tr.tbl-row")).map(
    (row) => row.querySelector("td:not(.tbl-check)")?.textContent ?? null,
  );

/** The tab a route is open in — the one the screen under test is bound to. */
const tabFor = (route: string) => store.currentWorkspace().tabs.find((t) => t.route === route)!;

function open() {
  store.openTab("/resources");
  return render(
    <ConsoleProvider>
      <Workloads route="/resources" />
    </ConsoleProvider>,
  );
}

describe("Workloads", () => {
  it("lists every workload kind at once, each row saying which it is", async () => {
    open();

    await waitFor(() => expect(rowNames()).toHaveLength(5));

    expect(within(screen.getByText("checkout").closest("tr")!).getByText("Deployment")).toBeTruthy();
    expect(within(screen.getByText("db").closest("tr")!).getByText("StatefulSet")).toBeTruthy();
    expect(within(screen.getByText("node-exporter").closest("tr")!).getByText("DaemonSet")).toBeTruthy();
    expect(within(screen.getByText("web-1").closest("tr")!).getByText("Pod")).toBeTruthy();
    expect(within(screen.getByText("nightly-backup").closest("tr")!).getByText("CronJob")).toBeTruthy();

    // Five kinds, five watches — never one list re-fetched as five rows.
    expect(watchResource).toHaveBeenCalledTimes(5);
  });

  it("narrows to one kind from the segment control", async () => {
    open();
    await waitFor(() => expect(rowNames()).toHaveLength(5));

    const callsBefore = watchResource.mock.calls.length;
    await userEvent.click(screen.getByRole("tab", { name: "Pod" }));

    await waitFor(() => expect(rowNames()).toEqual(["web-1"]));
    // Switching segments filters what's already in memory — it must not
    // reopen any of the five watches.
    expect(watchResource.mock.calls.length).toBe(callsBefore);

    await userEvent.click(screen.getByRole("tab", { name: "All" }));
    await waitFor(() => expect(rowNames()).toHaveLength(5));
  });

  it("sorts across kinds, not within them", async () => {
    open();
    await waitFor(() => expect(rowNames()).toHaveLength(5));

    await userEvent.click(screen.getByRole("button", { name: "Sort by Age" }));

    // Ascending by age in seconds: 1d, 2d, 10d, 30d, 120d — a run that only
    // exists by crossing every kind, since each kind here contributes just
    // one row.
    await waitFor(() =>
      expect(rowNames()).toEqual(["node-exporter", "web-1", "checkout", "db", "nightly-backup"]),
    );
  });

  it("opens the resource's /k/<kind>/<namespace>/<name> route, keyed by the row's own kind", async () => {
    open();
    await waitFor(() => expect(rowNames()).toHaveLength(5));

    // web-1 is a Pod in this union — its route must carry "Pod", not the
    // "/resources" route this list is itself opened at.
    fireEvent.doubleClick(screen.getByText("web-1").closest("tr")!);

    await waitFor(() => expect(tabFor("/k/Pod/default/web-1")).toBeTruthy());
    expect(store.currentWorkspace().activeId).toBe(tabFor("/k/Pod/default/web-1").id);
  });

  it("keeps listing the kinds that answered when one of the five fails", async () => {
    watchResource.mockImplementation(
      async (
        _context: string,
        _namespace: string,
        kind: string,
        onRows: (rows: unknown[]) => void,
        _onStatus: (status: "live" | "reconnecting") => void,
        onError: (message: string) => void,
      ) => {
        if (kind === "deployments") {
          onError("forbidden: cannot list deployments");
          return { stop };
        }
        onRows(FIXTURES[kind] ?? []);
        return { stop };
      },
    );

    open();

    await waitFor(() => expect(rowNames()).toHaveLength(4));
    expect(rowNames()).toEqual(
      expect.arrayContaining(["db", "node-exporter", "web-1", "nightly-backup"]),
    );
    expect(screen.queryByText("checkout")).toBeNull();

    expect(screen.getByText(/could not list deployments/i)).toBeTruthy();
    expect(screen.getByText(/forbidden: cannot list deployments/i)).toBeTruthy();
  });

  // Whole-branch review, Correction (a): zero options while `namespaces` is
  // still null reads as "this cluster has no namespaces" — a bare
  // `MultiSelect options={(namespaces ?? []).map(...)}` says exactly that.
  // `Resources.tsx` already shows a disabled, spinning stand-in instead; this
  // screen dropped the same treatment.
  it("shows the namespace picker as loading rather than empty before namespaces arrive", async () => {
    useNamespaceOptions.mockReturnValue({ namespaces: null, scope: "", error: "" });

    open();
    await waitFor(() => expect(rowNames()).toHaveLength(5));

    expect(screen.queryByRole("combobox", { name: "Namespaces" })).toBeNull();
    const placeholder = screen.getByRole("button", { name: "Namespaces" }) as HTMLButtonElement;
    expect(placeholder.disabled).toBe(true);
    expect(within(placeholder).getByRole("status", { name: "Loading namespaces" })).toBeTruthy();
  });

  // Whole-branch review, Correction (b): this screen destructured `{
  // namespaces, scope }` off `useNamespaceOptions` and dropped `error`
  // entirely, so a namespace-listing failure was silent. `Resources.tsx`
  // surfaces it in a warn Alert above the table without replacing the picker.
  it("warns above the table when namespace listing fails, without hiding the picker or the rows", async () => {
    useNamespaceOptions.mockReturnValue({
      namespaces: ["default", "kube-system"],
      scope: "",
      error: "namespaces: etcd timeout",
    });

    open();

    expect(await screen.findByText("Namespaces could not be listed")).toBeTruthy();
    expect(screen.getByText("namespaces: etcd timeout")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Namespaces" })).toBeTruthy();
    await waitFor(() => expect(rowNames()).toHaveLength(5));
  });

  // Whole-branch review, Correction (c): this screen rendered both its
  // failed-kind and stale Alerts inside `.scroll`, so they scrolled away with
  // the table. `Resources.tsx` hoists its banners out so they stay pinned.
  it("keeps a failed kind's alert outside the scrolling table body", async () => {
    watchResource.mockImplementation(
      async (
        _context: string,
        _namespace: string,
        kind: string,
        onRows: (rows: unknown[]) => void,
        _onStatus: (status: "live" | "reconnecting") => void,
        onError: (message: string) => void,
      ) => {
        if (kind === "deployments") {
          onError("forbidden: cannot list deployments");
          return { stop };
        }
        onRows(FIXTURES[kind] ?? []);
        return { stop };
      },
    );

    open();
    await waitFor(() => expect(screen.getByText(/could not list deployments/i)).toBeTruthy());

    const scrollBody = document.querySelector<HTMLElement>(".scroll")!;
    expect(within(scrollBody).queryByText(/could not list deployments/i)).toBeNull();
    // Still rendered — pinned above the scrolling body, not gone.
    expect(screen.getByText(/could not list deployments/i)).toBeTruthy();
  });

  // A union row's actions differ by kind — this is the per-row correctness
  // that matters: the menu is dispatched by `row.kind`, not by whichever
  // kind the segment control happens to be on, so it must never leak one
  // kind's actions onto another's row.
  it("offers a Pod row's own actions — logs and shell — and none of CronJob's", async () => {
    open();
    await waitFor(() => expect(rowNames()).toHaveLength(5));

    fireEvent.contextMenu(screen.getByText("web-1").closest("tr")!);

    expect(await screen.findByText("Follow logs")).toBeTruthy();
    expect(screen.getByText("Open shell")).toBeTruthy();
    expect(screen.getByText("Port forward")).toBeTruthy();
    expect(screen.getByText("Evict")).toBeTruthy();

    expect(screen.queryByText("Suspend")).toBeNull();
    expect(screen.queryByText("Run now")).toBeNull();
    expect(screen.queryByText("Scale")).toBeNull();
  });

  it("offers a CronJob row's own actions — suspend and run now — and none of Pod's", async () => {
    open();
    await waitFor(() => expect(rowNames()).toHaveLength(5));

    fireEvent.contextMenu(screen.getByText("nightly-backup").closest("tr")!);

    expect(await screen.findByText("Suspend")).toBeTruthy();
    expect(screen.getByText("Run now")).toBeTruthy();

    expect(screen.queryByText("Follow logs")).toBeNull();
    expect(screen.queryByText("Open shell")).toBeNull();
    expect(screen.queryByText("Port forward")).toBeNull();
    expect(screen.queryByText("Evict")).toBeNull();
    expect(screen.queryByText("Scale")).toBeNull();
  });

  it("opens a Deployment row's menu with scale and restart, and confirms a scale from the rendered screen", async () => {
    open();
    await waitFor(() => expect(rowNames()).toHaveLength(5));

    fireEvent.contextMenu(screen.getByText("checkout").closest("tr")!);
    expect(await screen.findByText("Scale")).toBeTruthy();
    expect(screen.getByText("Restart rollout")).toBeTruthy();
    expect(screen.queryByText("Suspend")).toBeNull();

    await userEvent.click(screen.getByText("Scale"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("checkout");
  });

  // Proves `WorkloadRow.suspended` is actually wired, not merely declared:
  // an unsuspended and a suspended CronJob side by side, so the label has to
  // follow each row's own state rather than reading the same either way.
  // (`isSuspended` treats a missing field exactly like `false`, which is why
  // a single always-unsuspended fixture couldn't catch this dropping.)
  it("labels the CronJob row menu by each row's own suspended state, and calls cronjobSetSuspend with the inverse", async () => {
    watchResource.mockImplementation(
      async (_c: string, _n: string, kind: string, onRows: (rows: unknown[]) => void) => {
        if (kind === "cronjobs") {
          onRows([
            { name: "nightly-backup", namespace: "default", schedule: "0 2 * * *", suspended: false, active: 0, lastSchedule: "2h ago", age: "120d" },
            { name: "paused-cleanup", namespace: "default", schedule: "0 3 * * *", suspended: true, active: 0, lastSchedule: "—", age: "60d" },
          ]);
          return { stop };
        }
        onRows(FIXTURES[kind] ?? []);
        return { stop };
      },
    );

    open();
    await waitFor(() => expect(rowNames()).toHaveLength(6));

    // Not suspended: the menu offers Suspend, not Resume.
    fireEvent.contextMenu(screen.getByText("nightly-backup").closest("tr")!);
    expect(await screen.findByText("Suspend")).toBeTruthy();
    expect(screen.queryByText("Resume")).toBeNull();
    await userEvent.click(screen.getByText("Suspend"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Suspend" }));
    await waitFor(() =>
      expect(cronjobSetSuspend).toHaveBeenCalledWith("prod-eu", "default", "nightly-backup", true),
    );

    // Already suspended: the menu offers Resume, not Suspend — and Resume
    // must call through with `suspend: false`, the inverse of the row's
    // current (suspended) state.
    fireEvent.contextMenu(screen.getByText("paused-cleanup").closest("tr")!);
    expect(await screen.findByText("Resume")).toBeTruthy();
    expect(screen.queryByText("Suspend")).toBeNull();
    await userEvent.click(screen.getByText("Resume"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(cronjobSetSuspend).toHaveBeenCalledWith("prod-eu", "default", "paused-cleanup", false),
    );
  });
});
