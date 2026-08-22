import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as ws from "./workspace";

beforeEach(() => ws.resetView());

describe("workspace view", () => {
  it("starts with no links and nothing expanded", () => {
    expect(ws.getView()).toEqual({ links: {}, expanded: [], namespaces: {} });
  });

  it("tells the hook when a link changes", () => {
    const { result } = renderHook(() => ws.useWorkspaceView());
    act(() => ws.setLink("prod", "connected"));
    expect(result.current.links.prod).toEqual({ state: "connected" });
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
    ws.setLink("a", "connected");
    ws.setLink("a", "connected");
    expect(n).toBe(1);
    off();
  });

  it("does not notify when setExpanded is handed the same list again", () => {
    ws.setExpanded(["a", "b"]);
    let n = 0;
    const off = ws.subscribe(() => n++);
    ws.setExpanded(["a", "b"]);
    ws.setExpanded([...ws.getView().expanded]);
    expect(n).toBe(0);
    ws.setExpanded(["b", "a"]);
    expect(n).toBe(1);
    off();
  });

  it("does not notify when resetView is called on an already-initial view", () => {
    let n = 0;
    const off = ws.subscribe(() => n++);
    ws.resetView();
    expect(n).toBe(0);
    ws.setLink("prod", "connected");
    ws.resetView();
    expect(n).toBe(2);
    off();
  });

  it("keeps a namespace selection per cluster, so two clusters do not share one", () => {
    ws.setNamespaces("prod", ["default"]);
    ws.setNamespaces("dev", ["kube-system"]);
    expect(ws.getView().namespaces).toEqual({ prod: ["default"], dev: ["kube-system"] });
  });

  it("reads an unset cluster as all namespaces", () => {
    expect(ws.getView().namespaces["never-set"]).toBeUndefined();
  });

  it("does not notify when the selection is set to what it already is", () => {
    ws.setNamespaces("prod", ["default"]);
    const seen = vi.fn();
    const off = ws.subscribe(seen);
    ws.setNamespaces("prod", ["default"]);
    off();
    expect(seen).not.toHaveBeenCalled();
  });
});
