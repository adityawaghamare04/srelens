import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { probeCluster, getInfo, useInfo, resetProbes } from "./probe";
import { getView, resetView } from "./workspace";

const ctx = { name: "prod-eu", stableId: "prod", cluster: "c", server: "", isCurrent: false };

beforeEach(() => { resetView(); resetProbes(); });

describe("probeCluster", () => {
  it("marks connecting, then connected with the version", async () => {
    let resolve!: (v: unknown) => void;
    const connect = vi.fn(() => new Promise<never>((r) => { resolve = r as never; }));
    const p = probeCluster(ctx, connect as never);
    expect(getView().links.prod).toEqual({ state: "connecting" });
    resolve({ context: "prod-eu", reachable: true, version: "v1.29.0" });
    await p;
    expect(getView().links.prod).toEqual({ state: "connected" });
    expect(getInfo("prod")?.version).toBe("v1.29.0");
  });
  it("marks error with the message when unreachable with one, disconnected without", async () => {
    await probeCluster(ctx, vi.fn().mockResolvedValue({ context: "prod-eu", reachable: false, error: "timeout" }) as never);
    expect(getView().links.prod).toEqual({ state: "error", error: "timeout" });
    await probeCluster(ctx, vi.fn().mockResolvedValue({ context: "prod-eu", reachable: false }) as never);
    expect(getView().links.prod).toEqual({ state: "disconnected" });
  });
  it("calls connectCluster with the context NAME, never the stableId", async () => {
    const connect = vi.fn().mockResolvedValue({ context: "prod-eu", reachable: true });
    await probeCluster(ctx, connect as never);
    expect(connect).toHaveBeenCalledWith("prod-eu");
  });
});

describe("useInfo", () => {
  it("re-renders with the info once the probe lands, and forgets it on reset", async () => {
    const { result } = renderHook(() => useInfo("prod"));
    expect(result.current).toBeUndefined();
    const connect = vi.fn().mockResolvedValue({ context: "prod-eu", reachable: true, version: "v1.30.1" });
    await act(async () => { await probeCluster(ctx, connect as never); });
    expect(result.current?.version).toBe("v1.30.1");
    act(() => resetProbes());
    expect(result.current).toBeUndefined();
  });
});
