import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The forwards store is core's — module-level, driven by the backend — so the
 * rows are supplied at that boundary rather than by starting a real tunnel.
 * The getter hands back the same array until it is swapped, which is what
 * `useSyncExternalStore` requires of it.
 *
 * **`forwardAddress` and `toKubectl` stay REAL.** They are the two things this
 * screen is forbidden from re-deriving, and a test that mocked them would
 * assert the screen calls a stub rather than that a web reader gets an address
 * they can actually open. The platform is flipped one layer lower instead —
 * `@srelens/core/platform` resolves to the same module `forward.ts` imports
 * `isTauri` from — so `forwardAddress` computes for real on both platforms.
 * `describeError` stays real for the same reason.
 */
const platform = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }));
vi.mock("@srelens/core/platform", async (orig) => ({
  ...(await orig<typeof import("@srelens/core/platform")>()),
  isTauri: platform.isTauri,
}));

const store = vi.hoisted(() => ({
  list: [] as unknown[],
  listeners: new Set<() => void>(),
}));
const core = vi.hoisted(() => ({
  stopPortForward: vi.fn(),
  rehydrateForwards: vi.fn(),
  // Only so the mounted dialog has something to list. What it does with them
  // is `NewForwardDialog.test.tsx`'s business; this file only cares that both
  // `New forward` buttons reach it.
  listNamespaces: vi.fn(),
  listServices: vi.fn(),
  listPods: vi.fn(),
}));
vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  getForwards: () => store.list,
  subscribeForwards: (l: () => void) => {
    store.listeners.add(l);
    return () => store.listeners.delete(l);
  },
  ...core,
}));

import { type ActiveForward, kindToForwardTarget, toKubectl } from "@srelens/core";
import { Forwards } from "./Forwards";

const ROUTE = "/forwards";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * §13's own four rows: four tunnels across three clusters, one of them
 * flapping, and a Pod among the Services so the target prefix has something to
 * be wrong about.
 *
 * The byte totals are chosen so the sum matches NO individual row — 54.5 MB is
 * not 1.2, 44.1, 0.312 or 8.9 — because a traffic badge asserted against a
 * single-row fixture passes whether it sums or merely echoes.
 */
function fixture(now: number): ActiveForward[] {
  return [
    {
      id: 1,
      context: "prod-eu",
      namespace: "checkout",
      kind: "Service",
      name: "checkout-api",
      localPort: 8080,
      remotePort: 8080,
      status: "active",
      bytesMoved: 1_200_000,
      startedAt: now - 18 * MINUTE,
    },
    {
      id: 2,
      context: "prod-eu",
      namespace: "observability",
      kind: "Service",
      name: "prometheus",
      localPort: 9090,
      remotePort: 9090,
      status: "active",
      bytesMoved: 44_100_000,
      startedAt: now - 2 * HOUR - 4 * MINUTE,
    },
    {
      id: 3,
      context: "prod-us",
      namespace: "search",
      kind: "Pod",
      name: "search-indexer-0",
      localPort: 6060,
      remotePort: 6060,
      status: "active",
      bytesMoved: 312_000,
      startedAt: now - 6 * MINUTE,
    },
    {
      id: 4,
      context: "staging",
      namespace: "identity",
      kind: "Service",
      // The one row whose ports differ from each other, so a cell that printed
      // the wrong one of the two would be caught rather than agree by accident.
      name: "identity-gateway",
      localPort: 8443,
      remotePort: 443,
      status: "reconnecting",
      bytesMoved: 8_900_000,
      startedAt: now - 51 * MINUTE,
    },
  ];
}

let NOW = 0;

beforeEach(() => {
  vi.clearAllMocks();
  platform.isTauri.mockReturnValue(true);
  core.stopPortForward.mockResolvedValue(undefined);
  core.rehydrateForwards.mockResolvedValue(undefined);
  core.listNamespaces.mockResolvedValue({ namespaces: ["checkout"] });
  core.listServices.mockResolvedValue({ services: [] });
  core.listPods.mockResolvedValue({ pods: [] });
  NOW = Date.now();
  store.list = fixture(NOW);
  store.listeners.clear();
});

/** Swap the array the way the store does — a new identity, then a notify. */
function setForwards(next: ActiveForward[]) {
  act(() => {
    store.list = next;
    for (const l of store.listeners) l();
  });
}

function open() {
  return render(<Forwards route={ROUTE} />);
}

const headers = () =>
  Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
const rowFor = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
const cells = (row: HTMLElement) =>
  Array.from(row.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
const cell = (row: HTMLElement, i: number) => row.querySelectorAll("td")[i] as HTMLElement;

/** jsdom ships no clipboard at all, so there is nothing to spy on. */
function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

describe("Forwards — the table", () => {
  it("draws §13's columns in §13's order", () => {
    open();
    expect(headers()).toEqual([
      "Target",
      "Cluster",
      "Local",
      "Remote",
      "State",
      "Traffic",
      "Age",
      "",
    ]);
  });

  it("names the target through core's mapping, not a second copy of it", () => {
    open();
    // The mapping this screen used to keep its own `{ Service: "svc" }` table
    // for. Read from core so a drift between the cell and the copied command
    // is not possible rather than merely unlikely.
    expect(kindToForwardTarget("Service")).toBe("svc");
    expect(kindToForwardTarget("Pod")).toBe("pod");
    expect(cells(rowFor("svc/checkout-api"))[0]).toContain(
      `${kindToForwardTarget("Service")}/checkout-api`,
    );
    expect(cells(rowFor("pod/search-indexer-0"))[0]).toContain(
      `${kindToForwardTarget("Pod")}/search-indexer-0`,
    );
  });

  it("names the target the way kubectl does, over its namespace", () => {
    open();
    const svc = cell(rowFor("svc/checkout-api"), 0);
    expect(within(svc).getByText("svc/checkout-api")).toBeTruthy();
    expect(within(svc).getByText("checkout")).toBeTruthy();

    // A Pod is `pod/`, not `svc/` — the prefix is read off the kind, not
    // assumed from the commoner case.
    const pod = cell(rowFor("pod/search-indexer-0"), 0);
    expect(within(pod).getByText("pod/search-indexer-0")).toBeTruthy();
    expect(within(pod).getByText("search")).toBeTruthy();
  });

  it("keeps a long context name inside its own cell", () => {
    // A kubeconfig context is user-chosen and routinely long. Seen against a
    // real cluster, `m01-1786968575165/kubernetes-admin@cluster.local` drew
    // straight over the Local cell beside it and both were unreadable.
    //
    // `truncate` sets `overflow: hidden`, which does nothing to an inline box,
    // so the cell has to be a block for the ellipsis to happen at all. jsdom
    // lays nothing out, so this asserts the mechanism rather than the pixels —
    // the third time column overflow has shipped on this project, and every
    // time it was invisible to the suite.
    render(<Forwards route="/forwards" />);
    const cluster = rowFor("svc/checkout-api").querySelectorAll("td")[1];
    const inner = cluster.querySelector("span");
    expect(inner?.className).toContain("truncate");
    expect(inner?.className).toContain("block");
  });

  it("gives each row its cluster, ports, traffic and age", () => {
    open();
    expect(cells(rowFor("svc/identity-gateway")).slice(1, 7)).toEqual([
      "staging",
      // Desktop: the address really is the loopback port.
      "localhost:8443",
      ":443",
      "Reconnecting",
      "8.9 MB",
      "51m",
    ]);
    expect(cells(rowFor("pod/search-indexer-0")).slice(5, 7)).toEqual(["312 KB", "6m"]);
    expect(cells(rowFor("svc/prometheus")).slice(5, 7)).toEqual(["44.1 MB", "2h"]);
  });

  it("counts the tunnels and the clusters they cross", () => {
    open();
    // Four forwards, three distinct contexts — the count is over the contexts
    // present, not over the rows.
    expect(screen.getByText(/Active tunnels · 4 across 3 clusters/i)).toBeTruthy();
  });

  it("says a single cluster in the singular", () => {
    setForwardsBeforeMount([fixture(NOW)[0]]);
    open();
    expect(screen.getByText(/Active tunnels · 1 across 1 cluster$/i)).toBeTruthy();
  });

  it("badges the traffic every tunnel has moved, added up", () => {
    open();
    // 1.2 + 44.1 + 0.312 + 8.9 MB. Deliberately not equal to any one row.
    expect(screen.getByText("54.5 MB moved")).toBeTruthy();
  });

  it("re-renders when the store changes", () => {
    open();
    expect(screen.queryByText("svc/prometheus")).toBeTruthy();
    setForwards(fixture(NOW).filter((f) => f.id !== 2));
    expect(screen.queryByText("svc/prometheus")).toBeNull();
    expect(screen.getByText(/Active tunnels · 3 across 3 clusters/i)).toBeTruthy();
  });
});

describe("Forwards — the state word", () => {
  it("reads a healthy tunnel plainly and a flapping one in the warning tone", () => {
    open();
    const active = cell(rowFor("svc/checkout-api"), 4).querySelector(".status") as HTMLElement;
    expect(active.textContent).toBe("Active");
    expect(active.getAttribute("data-kind")).toBe("success");
    // §13's asymmetric colouring rule: a good state is not worth the ink.
    expect(active.getAttribute("data-bad")).toBeNull();

    const flapping = cell(rowFor("svc/identity-gateway"), 4).querySelector(
      ".status",
    ) as HTMLElement;
    expect(flapping.textContent).toBe("Reconnecting");
    expect(flapping.getAttribute("data-kind")).toBe("warning");
    expect(flapping.getAttribute("data-bad")).toBe("true");
  });

  it("reads a forward that gave up as failed, in the severe tone", () => {
    // §13 draws only `active` and `reconnecting` and says "else warn". `failed`
    // is core's third status and it is not a warning — the tunnel is gone.
    const failed = fixture(NOW).map((f) => (f.id === 4 ? { ...f, status: "failed" as const } : f));
    setForwardsBeforeMount(failed);
    open();
    const gone = cell(rowFor("svc/identity-gateway"), 4).querySelector(".status") as HTMLElement;
    expect(gone.textContent).toBe("Failed");
    expect(gone.getAttribute("data-kind")).toBe("danger");
    expect(gone.getAttribute("data-bad")).toBe("true");
  });
});

describe("Forwards — the row's actions", () => {
  it("copies the kubectl command core writes, not one assembled here", async () => {
    const writeText = stubClipboard();
    open();
    await userEvent.click(
      within(rowFor("svc/checkout-api")).getByRole("button", {
        name: /copy kubectl command/i,
      }),
    );
    expect(writeText).toHaveBeenCalledWith(
      toKubectl({
        action: "port-forward",
        kind: "Service",
        name: "checkout-api",
        context: "prod-eu",
        namespace: "checkout",
        localPort: 8080,
        remotePort: 8080,
      }),
    );
    // And the command really is the port-forward one, so the assertion above
    // is not two identical mistakes agreeing.
    expect(writeText.mock.calls[0][0]).toContain("port-forward svc/checkout-api 8080:8080");
  });

  it("copies the loopback address on the desktop", async () => {
    const writeText = stubClipboard();
    open();
    await userEvent.click(
      within(rowFor("svc/checkout-api")).getByRole("button", { name: /copy address/i }),
    );
    expect(writeText).toHaveBeenCalledWith("localhost:8080");
  });

  it("copies the proxy address in the browser, where a container's loopback is unreachable", async () => {
    // The whole reason §13's literal `http://localhost:<local>` is not shipped.
    platform.isTauri.mockReturnValue(false);
    const writeText = stubClipboard();
    open();
    await userEvent.click(
      within(rowFor("svc/checkout-api")).getByRole("button", { name: /copy address/i }),
    );
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toBe(`${window.location.origin}/pf/1/`);
    // Said twice on purpose: jsdom's own origin contains "localhost", so the
    // equality above would still hold for a screen that had hardcoded the
    // desktop answer at some other port. This is the property.
    expect(copied).toContain("/pf/1/");
    expect(copied).not.toBe("localhost:8080");
  });

  it("shows the reachable address in the Local cell, the same one it copies", async () => {
    platform.isTauri.mockReturnValue(false);
    const writeText = stubClipboard();
    open();
    const shown = cells(rowFor("svc/checkout-api"))[2];
    expect(shown).toBe(`${window.location.origin}/pf/1/`);
    await userEvent.click(
      within(rowFor("svc/checkout-api")).getByRole("button", { name: /copy address/i }),
    );
    expect(writeText).toHaveBeenCalledWith(shown);
  });

  it("stops the forward the button is standing in, by id", async () => {
    open();
    await userEvent.click(
      within(rowFor("svc/identity-gateway")).getByRole("button", { name: /stop forwarding/i }),
    );
    // Id 4, not the first row's 1 and not the row's index.
    expect(core.stopPortForward).toHaveBeenCalledWith(4);
    expect(core.stopPortForward).toHaveBeenCalledTimes(1);
  });

  it("says why a stop was refused, in words rather than in Rust", async () => {
    core.stopPortForward.mockRejectedValue(
      new Error("ApiError: Unauthorized (Status { metadata: Some(ListMeta { .. }) })"),
    );
    open();
    await userEvent.click(
      within(rowFor("svc/checkout-api")).getByRole("button", { name: /stop forwarding/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Could not stop svc\/checkout-api/i)).toBeTruthy(),
    );
    // `describeError`'s own classification, not the struct.
    expect(screen.getByText(/rejected your credentials/i)).toBeTruthy();
    const raw = document.querySelector('[data-slot="raw"]');
    expect(raw?.textContent).toContain("ApiError");
    // The struct appears ONLY inside the disclosure — never as the message.
    const alert = screen.getByText(/rejected your credentials/i).closest("[data-tone]");
    expect(alert?.querySelector('[data-slot="raw"]')).toBeTruthy();
  });

  it("puts no address, port or command in a title attribute", () => {
    open();
    const titles = Array.from(document.querySelectorAll("[title]")).map(
      (el) => el.getAttribute("title") ?? "",
    );
    // The buttons DO carry names — that is what makes four rows of identical
    // glyphs navigable. What they must not carry is a value: the rule
    // `PairList` and `KV` were stripped for.
    expect(titles.length).toBeGreaterThan(0);
    const joined = titles.join("\n");
    // The address, either platform's form.
    expect(joined).not.toContain("localhost:");
    expect(joined).not.toContain("/pf/");
    // The command — its flags, its target and its port pair.
    expect(joined).not.toContain("--context");
    expect(joined).not.toContain("port-forward");
    // Any port at all: the ports these four rows are bound to.
    for (const port of ["8080", "9090", "6060", "8443", "443"]) {
      expect(joined).not.toContain(port);
    }
  });
});

describe("Forwards — the screen around the table", () => {
  it("adopts the forwards the backend is still running, once, on mount", async () => {
    open();
    // The web-mode leak this screen exists to close: the store is module-level
    // JavaScript and a reload empties it while the server keeps forwarding.
    await waitFor(() => expect(core.rehydrateForwards).toHaveBeenCalledTimes(1));
  });

  it("offers the New forward action from the header", () => {
    open();
    const actions = document.querySelector('[data-slot="screen-actions"]') as HTMLElement;
    expect(within(actions).getByRole("button", { name: "New forward" })).toBeTruthy();
  });

  it("opens §A.4's dialog from the header action", async () => {
    open();
    expect(screen.queryByRole("dialog")).toBeNull();
    const actions = document.querySelector('[data-slot="screen-actions"]') as HTMLElement;
    await userEvent.click(within(actions).getByRole("button", { name: "New forward" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New port forward")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the SAME dialog from the empty state's way out", async () => {
    // The two buttons share one handler, and the dialog is mounted beside the
    // body rather than inside either branch — so a reader with no tunnels gets
    // the dialog too. An assertion on the header alone would pass either way.
    setForwardsBeforeMount([]);
    open();
    const empty = screen.getByText("No port forwards").closest("div")
      ?.parentElement as HTMLElement;
    await userEvent.click(within(empty).getByRole("button", { name: "New forward" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New port forward")).toBeTruthy();
    // And the emptiness is still behind it.
    expect(screen.getByText("No port forwards")).toBeTruthy();
  });

  it("ships the empty state §13 defines and never renders", () => {
    setForwardsBeforeMount([]);
    open();
    expect(screen.getByText("No port forwards")).toBeTruthy();
    expect(
      screen.getByText(
        "Forward a service port to reach it from this machine. Nothing is exposed outside your laptop.",
      ),
    ).toBeTruthy();
    // The way out of the emptiness, which is the whole point of the slot.
    const empty = screen.getByText("No port forwards").closest("div")?.parentElement as HTMLElement;
    expect(within(empty).getByRole("button", { name: "New forward" })).toBeTruthy();
  });

  it("heads nothing over an empty screen", () => {
    setForwardsBeforeMount([]);
    open();
    // No pane head counting tunnels that are not there, and no badge claiming
    // a total that nothing moved. (`headers()` is not the assertion: `Table`
    // draws its own empty state over an empty `data`, so a screen that never
    // branched at all would still report no columns here.)
    expect(document.querySelector(".pane-head")).toBeNull();
    expect(screen.queryByText(/moved/)).toBeNull();
  });
});

/** Seed the store before the screen mounts, for the cases about first paint. */
function setForwardsBeforeMount(next: ActiveForward[]) {
  store.list = next;
}
