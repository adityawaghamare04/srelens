import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Chrome } from "./Chrome";
import {
  createWorkspace,
  currentWorkspace,
  getState,
  openTab,
  setState,
  switchWorkspace,
} from "../lib/tabsStore";
import { defaultState } from "../lib/tabs";

// jsdom has no ResizeObserver and Radix's popper watches the trigger with one.
// The same stub the kit's Radix-backed suites carry, kept here rather than in
// the shared setup so the requirement stays visible.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Scale is core's, and core's writes it to storage and asks the webview to
// zoom. Both are mocked: this suite is about the buttons calling the right
// thing with the right number, and `stepUiScale` stays real so the number is
// the one the app would use.
const { scale, desktop } = vi.hoisted(() => ({
  scale: { get: vi.fn(() => 100), set: vi.fn((n: number) => n), apply: vi.fn() },
  desktop: vi.fn(() => true),
}));
vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  getUiScale: scale.get,
  setUiScale: scale.set,
  applyUiScale: scale.apply,
  isTauri: desktop,
}));

const ctx = (id: string) => ({ name: id, stableId: id, cluster: id, server: "", isCurrent: false });

beforeEach(() => {
  setState(defaultState([ctx("prod")]));
  vi.clearAllMocks();
  // `clearAllMocks` forgets the calls, not the implementations — so a test that
  // asked for web mode would leak into the next one without this.
  desktop.mockReturnValue(true);
});

const chrome = (props: Partial<Parameters<typeof Chrome>[0]> = {}) =>
  render(<Chrome controls="none" onToggleTheme={() => {}} onNewWorkspace={() => {}} {...props} />);

/** The chip is the first button in the bar; the panel is portalled after it. */
const openSwitcher = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Default/ }));
  await screen.findByRole("dialog", { name: "Workspaces" });
};

describe("Chrome", () => {
  it("names the workspace and the active cluster in the bar", () => {
    chrome({ clusterName: "prod" });
    expect(screen.getByRole("button", { name: /Default/ })).toBeDefined();
    expect(screen.getByText("prod")).toBeDefined();
  });

  it("zooms through uiScale", async () => {
    chrome();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(scale.set).toHaveBeenCalledWith(110);
    expect(scale.apply).toHaveBeenCalledWith(110);
  });

  it("switches workspaces from the switcher", async () => {
    const id = createWorkspace("Team", ["prod"]);
    setState({ ...getState(), currentId: getState().workspaces[0].id });
    chrome();
    await openSwitcher();
    await userEvent.click(screen.getByRole("button", { name: /^Team/ }));
    expect(currentWorkspace().id).toBe(id);
  });

  it("asks before removing a workspace holding tabs the user opened", async () => {
    const id = createWorkspace("Team", ["prod"]);
    // `createWorkspace` switches into it, so this tab lands in Team.
    openTab("/k/pods");
    switchWorkspace(getState().workspaces[0].id);
    chrome();
    await openSwitcher();
    await userEvent.click(screen.getByRole("button", { name: /Remove Team/ }));
    expect(screen.getByRole("dialog", { name: /Remove Team/ })).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(getState().workspaces.some((w) => w.id === id)).toBe(false);
  });

  it("removes a workspace holding only its pinned home tab without asking", async () => {
    // Nothing to lose: a question here is a question about nothing.
    const id = createWorkspace("Team", ["prod"]);
    switchWorkspace(getState().workspaces[0].id);
    chrome();
    await openSwitcher();
    await userEvent.click(screen.getByRole("button", { name: /Remove Team/ }));
    expect(screen.queryByRole("dialog", { name: /Remove Team/ })).toBeNull();
    expect(getState().workspaces.some((w) => w.id === id)).toBe(false);
  });

  it("keeps the workspace when the confirmation is dismissed", async () => {
    const id = createWorkspace("Team", ["prod"]);
    openTab("/k/pods");
    switchWorkspace(getState().workspaces[0].id);
    chrome();
    await openSwitcher();
    await userEvent.click(screen.getByRole("button", { name: /Remove Team/ }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Remove Team/ })).toBeNull());
    expect(getState().workspaces.some((w) => w.id === id)).toBe(true);
  });

  it("offers no zoom controls in web mode, where the browser's own zoom applies", () => {
    desktop.mockReturnValue(false);
    chrome();
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(screen.getByRole("button", { name: "Theme" })).toBeDefined();
  });

  it("opens Settings from the appearance action and calls the theme toggle", async () => {
    const onToggleTheme = vi.fn();
    chrome({ onToggleTheme });
    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(onToggleTheme).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Appearance settings" }));
    expect(currentWorkspace().tabs.some((t) => t.route === "/settings")).toBe(true);
  });

  it("asks the switcher for a new workspace rather than making one itself", async () => {
    const onNewWorkspace = vi.fn();
    chrome({ onNewWorkspace });
    await openSwitcher();
    await userEvent.click(screen.getByRole("button", { name: "New workspace" }));
    expect(onNewWorkspace).toHaveBeenCalledTimes(1);
    expect(getState().workspaces).toHaveLength(1);
  });
});
