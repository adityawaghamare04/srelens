import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { watchResource, useNamespaceOptions } = vi.hoisted(() => ({
  watchResource: vi.fn(),
  useNamespaceOptions: vi.fn(),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  watchResource: (...a: unknown[]) => watchResource(...a),
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
});
