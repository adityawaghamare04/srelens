import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as ws from "./workspace";

beforeEach(() => ws.resetView());

describe("workspace view", () => {
  it("starts with no active cluster, no links, nothing expanded", () => {
    expect(ws.getView()).toEqual({ activeCluster: null, links: {}, expanded: [] });
  });

  it("sets the active cluster and tells the hook", () => {
    const { result } = renderHook(() => ws.useWorkspaceView());
    act(() => ws.setActiveCluster("prod"));
    expect(result.current.activeCluster).toBe("prod");
  });

  it("records a link state per cluster, with an error when there is one", () => {
    ws.setLink("a", "connecting");
    ws.setLink("b", "error", "dial tcp: refused");
    expect(ws.getView().links).toEqual({
      a: { state: "connecting" },
      b: { state: "error", error: "dial tcp: refused" },
    });
  });

  it("drops a stale error when the state moves on", () => {
    ws.setLink("a", "error", "x");
    ws.setLink("a", "connected");
    expect(ws.getView().links.a).toEqual({ state: "connected" });
  });

  it("toggles expansion", () => {
    ws.toggleExpanded("workloads");
    expect(ws.getView().expanded).toEqual(["workloads"]);
    ws.toggleExpanded("workloads");
    expect(ws.getView().expanded).toEqual([]);
  });

  it("replaces expansion wholesale when told", () => {
    ws.toggleExpanded("a");
    ws.setExpanded(["b", "c"]);
    expect(ws.getView().expanded).toEqual(["b", "c"]);
  });

  it("does not notify for a no-op", () => {
    let n = 0;
    const { result } = renderHook(() => ws.useWorkspaceView());
    void result;
    const off = ws.subscribe(() => n++);
    ws.setActiveCluster(null);
    ws.setLink("a", "connected");
    ws.setLink("a", "connected");
    expect(n).toBe(1);
    off();
  });
});
