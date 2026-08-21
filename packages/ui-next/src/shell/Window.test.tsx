import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// `vi.hoisted` because `vi.mock` is hoisted above every declaration in the
// file, and the tabsPersist factory reads these the moment `./Window` imports
// the module — a plain `const` is still in its temporal dead zone by then.
const { listContexts, loadTabsState, scheduleSave, installFlushOnUnload } = vi.hoisted(() => ({
  listContexts: vi.fn(),
  loadTabsState: vi.fn(),
  scheduleSave: vi.fn(),
  installFlushOnUnload: vi.fn(() => () => {}),
}));

vi.mock("@srelens/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@srelens/core")>();
  return { ...real, listContexts: (...a: unknown[]) => listContexts(...a) };
});

vi.mock("../lib/tabsPersist", () => ({ loadTabsState, scheduleSave, installFlushOnUnload, flushSave: () => {} }));

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

  it("saves on every store change after boot, and flushes on unload", async () => {
    await booted();
    expect(installFlushOnUnload).toHaveBeenCalled();
    act(() => store.openTab("/k/pods"));
    expect(scheduleSave).toHaveBeenCalledWith(store.getState());
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

  it("hands the Placeholder the way back to classic", async () => {
    const onOpenInClassic = vi.fn();
    render(<Window ported={[]} onOpenInClassic={onOpenInClassic} />);
    await waitFor(() => expect(screen.getByRole("tablist")).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: /open in classic/i }));
    expect(onOpenInClassic).toHaveBeenCalledWith("/");
  });
});
