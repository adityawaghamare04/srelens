import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `vi.hoisted` because `vi.mock` is hoisted above every declaration in the
// file, and the tabsPersist factory reads these the moment `./Window` imports
// the module — a plain `const` is still in its temporal dead zone by then.
const { listContexts, loadTabsState, scheduleSave, installFlushOnUnload, flushSave } = vi.hoisted(() => ({
  listContexts: vi.fn(),
  loadTabsState: vi.fn(),
  scheduleSave: vi.fn(),
  installFlushOnUnload: vi.fn(() => () => {}),
  flushSave: vi.fn(),
}));

vi.mock("@srelens/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@srelens/core")>();
  return { ...real, listContexts: (...a: unknown[]) => listContexts(...a) };
});

vi.mock("../lib/tabsPersist", () => ({ loadTabsState, scheduleSave, installFlushOnUnload, flushSave }));

// jsdom has no ResizeObserver; TabStrip's overflow Popover wants one.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { Window } from "./Window";
import * as store from "../lib/tabsStore";
import { defaultState, makeTab } from "../lib/tabs";

const ctx = (stableId: string, name = stableId) => ({ name, stableId, cluster: name, server: "", isCurrent: false });

beforeEach(() => {
  listContexts.mockReset().mockResolvedValue({ contexts: [ctx("prod")] });
  loadTabsState.mockReset().mockReturnValue(null);
  scheduleSave.mockReset();
  // Cleared so "flushes on unload" can actually fail: a spy that is never
  // cleared stays called from the first test in the file onwards.
  installFlushOnUnload.mockClear();
  flushSave.mockClear();
  store.setState(defaultState([]));
});

async function booted() {
  render(<Window ported={[]} onOpenInClassic={() => {}} />);
  await waitFor(() => expect(screen.getByRole("tablist")).toBeDefined());
}

describe("Window boot", () => {
  it("builds a Default workspace from the contexts when nothing was saved", async () => {
    await booted();
    expect(store.getState().workspaces[0].name).toBe("Default");
    expect(store.getState().workspaces[0].clusters).toEqual(["prod"]);
  });

  it("restores a saved state and reconciles it against the contexts", async () => {
    const saved = defaultState([ctx("prod"), ctx("gone")]);
    saved.workspaces[0].tabs.push(makeTab("/k/pods"));
    loadTabsState.mockReturnValue(saved);
    await booted();
    expect(store.getState().workspaces[0].clusters).toEqual(["prod"]);
    expect(screen.getByRole("tab", { name: /Pods/ })).toBeDefined();
  });

  it("still boots when listing contexts fails", async () => {
    listContexts.mockResolvedValue({ error: "kubeconfig unreadable" });
    await booted();
    expect(store.getState().workspaces).toHaveLength(1);
    expect(store.getState().workspaces[0].clusters).toEqual([]);
  });

  it("shows a loading state rather than the wrong tabs before boot resolves", () => {
    let resolve!: (v: unknown) => void;
    listContexts.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Window ported={[]} onOpenInClassic={() => {}} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText(/loading/i)).toBeDefined();
    act(() => resolve({ contexts: [] }));
  });

  it("still boots when reading the saved state throws", async () => {
    // `loadTabsState` guards its own storage, but the boot body is what has to
    // survive: an exception here rejected the IIFE, `setBooted(true)` never
    // ran, and the spinner stayed up forever with no Placeholder and no way
    // back to classic.
    loadTabsState.mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    await booted();
    expect(store.getState().workspaces[0].clusters).toEqual(["prod"]);
  });

  it("saves on every store change after boot, and flushes on unload", async () => {
    await booted();
    expect(installFlushOnUnload).toHaveBeenCalled();
    act(() => store.openTab("/k/pods"));
    expect(scheduleSave).toHaveBeenCalledWith(store.getState());
  });

  it("flushes the debounced save when it unmounts", async () => {
    // Unmounting mid-debounce — the gallery round trip, a design switch —
    // dropped up to 300ms of changes: the unload listener never fires, so
    // taking it off without writing threw the pending state away.
    const view = render(<Window ported={[]} onOpenInClassic={() => {}} />);
    await waitFor(() => expect(screen.getByRole("tablist")).toBeDefined());
    act(() => store.openTab("/k/pods"));
    expect(flushSave).not.toHaveBeenCalled();
    view.unmount();
    expect(flushSave).toHaveBeenCalled();
  });
});

describe("Window strip", () => {
  it("renders every tab and shows only the active one's body", async () => {
    await booted();
    act(() => store.openTab("/k/pods", { clusterName: "prod" }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Both bodies are mounted; only the active is visible.
    const headings = screen.getAllByRole("heading", { level: 1, hidden: true });
    expect(headings.map((h) => h.textContent)).toEqual(["Control room", "Pods"]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Pods");
  });

  it("selecting a tab switches the body", async () => {
    await booted();
    act(() => store.openTab("/k/pods"));
    await userEvent.click(screen.getByRole("tab", { name: /Control room/ }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Control room");
  });

  it("closing a tab goes through the store", async () => {
    await booted();
    act(() => store.openTab("/k/pods"));
    await userEvent.click(screen.getByRole("button", { name: /close pods/i }));
    expect(store.currentWorkspace().tabs).toHaveLength(1);
  });

  it("new tab opens the home route as a second tab", async () => {
    await booted();
    await userEvent.click(screen.getByRole("button", { name: /new tab/i }));
    expect(store.currentWorkspace().tabs.map((t) => t.route)).toEqual(["/", "/"]);
  });

  it("does not name an arbitrary cluster on a new tab", async () => {
    // `contexts[0]` is whichever context the kubeconfig happens to list first
    // — not the current one, and not necessarily even in this workspace — and
    // `TabStrip` reads `sub` into the accessible name, so the tab announced
    // itself as being on a cluster the user had not chosen. PR 2 wires the
    // active cluster; until then a tab names no cluster at all.
    listContexts.mockResolvedValue({ contexts: [ctx("prod", "prod-eu")] });
    await booted();
    await userEvent.click(screen.getByRole("button", { name: /new tab/i }));
    const opened = store.currentWorkspace().tabs.at(-1)!;
    expect(opened.sub).toBeUndefined();
    expect(screen.getAllByRole("tab").at(-1)!.textContent).not.toContain("prod-eu");
  });

  it("hands the Placeholder the way back to classic", async () => {
    const onOpenInClassic = vi.fn();
    render(<Window ported={[]} onOpenInClassic={onOpenInClassic} />);
    await waitFor(() => expect(screen.getByRole("tablist")).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: /open in classic/i }));
    expect(onOpenInClassic).toHaveBeenCalledWith("/");
  });
});
