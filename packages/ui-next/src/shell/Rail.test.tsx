import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClusterContext } from "@srelens/core";
import { Rail } from "./Rail";
import { activeCluster, currentWorkspace, setState } from "../lib/tabsStore";
import { defaultState } from "../lib/tabs";
import { resetView, setLink } from "../lib/workspace";
import { loadMarks } from "../lib/marks";
import { resetProbes } from "../lib/probe";

// jsdom has no ResizeObserver and Radix's popper — which the kit's Tooltip, and
// so every rail button, sits on — watches its trigger with one. The same stub
// Chrome.test.tsx carries, kept per file so the requirement stays visible.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const ctx = (name: string): ClusterContext => ({
  name,
  stableId: name,
  cluster: name,
  server: `https://${name}.example`,
  isCurrent: false,
});

const CONTEXTS = [ctx("prod-eu"), ctx("staging")];

beforeEach(() => {
  setState(defaultState(CONTEXTS));
  resetView();
  resetProbes();
  // Marks persist through `settingsStorage`; the shared setup clears
  // localStorage between tests, so this puts the in-memory copy back with it.
  loadMarks();
  vi.clearAllMocks();
});

function setup(props: Partial<Parameters<typeof Rail>[0]> = {}) {
  const onConnect = vi.fn();
  const view = render(<Rail contexts={CONTEXTS} onConnect={onConnect} {...props} />);
  return { onConnect, ...view };
}

/** The drawer is the kit's `Drawer`: an aside named "Details". */
const drawer = () => screen.getByRole("complementary", { name: "Details" });

describe("Rail", () => {
  it("lists the workspace's clusters and selects the one clicked", async () => {
    setup();
    expect(screen.getByRole("button", { name: "prod-eu" })).toBeDefined();
    expect(screen.getByRole("button", { name: "staging" })).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "staging" }));
    expect(activeCluster()).toBe("staging");
  });

  it("says why a cluster is out of reach in its name", () => {
    setLink("prod-eu", "error", "connection refused");
    setup();
    expect(screen.getByRole("button", { name: "prod-eu, connection refused" })).toBeDefined();
  });

  it("opens the cluster's drawer on the menu gesture and removes it from the workspace", async () => {
    setup();
    fireEvent.contextMenu(screen.getByRole("button", { name: "prod-eu" }));

    const panel = drawer();
    expect(panel.querySelector("header")?.textContent).toContain("prod-eu");

    await userEvent.click(screen.getByRole("button", { name: "Remove from workspace" }));
    expect(currentWorkspace().clusters).toEqual(["staging"]);
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });

  it("asks the app to connect a cluster", async () => {
    const { onConnect } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Connect a cluster" }));
    expect(onConnect).toHaveBeenCalled();
  });
});
