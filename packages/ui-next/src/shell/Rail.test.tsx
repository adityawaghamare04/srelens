import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClusterContext } from "@srelens/core";
import { Rail } from "./Rail";
import { activeCluster, currentWorkspace, setState } from "../lib/tabsStore";
import { defaultState } from "../lib/tabs";
import { resetView, setLink } from "../lib/workspace";
import { defaultMark, loadMarks, setMark } from "../lib/marks";
import { probeCluster, resetProbes } from "../lib/probe";

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

  it("draws a customised mark, and still names the button after the context", () => {
    setMark("prod-eu", { ...defaultMark("prod-eu"), name: "Production EU", short: "PX" });
    setup();
    // The rail is a list of the workspace's contexts: what a button is called
    // is the context's business, and what the square says is the mark's.
    expect(screen.getByRole("button", { name: "prod-eu" })).toBeDefined();
    expect(screen.getByText("PX")).toBeDefined();
  });

  it("draws a stored image mark", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    setMark("prod-eu", { ...defaultMark("prod-eu"), mark: "image", imageSrc: png });
    const { container } = setup();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(png);
  });

  // The hint's contents, not the subscription: `probeCluster` always moves the
  // link through `connecting` on its way, so the workspace store emits on every
  // probe and this would pass on a rail subscribed to nothing at all. That the
  // probe store is readable on its own is `probe.test.ts`'s `useInfos` test.
  it("puts the version and the server in the hint once the probe lands", async () => {
    setup();
    const connect = vi.fn().mockResolvedValue({ context: "prod-eu", reachable: true, version: "v1.31.0" });
    await act(async () => {
      await probeCluster(CONTEXTS[0], connect as never);
    });
    // Focus rather than hover: Radix opens the tooltip on focus with no delay.
    await act(async () => screen.getByRole("button", { name: "prod-eu" }).focus());
    const tip = await screen.findAllByText("prod-eu — v1.31.0 · https://prod-eu.example");
    expect(tip.length).toBeGreaterThan(0);
  });

  it("drops a drawer whose context has gone, and does not reopen it when it returns", () => {
    const { rerender } = setup();
    fireEvent.contextMenu(screen.getByRole("button", { name: "prod-eu" }));
    expect(drawer()).toBeDefined();

    rerender(<Rail contexts={[CONTEXTS[1]]} onConnect={() => {}} />);
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();

    // A kubeconfig that flickers must not reopen a panel nobody asked for.
    rerender(<Rail contexts={CONTEXTS} onConnect={() => {}} />);
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });
});
