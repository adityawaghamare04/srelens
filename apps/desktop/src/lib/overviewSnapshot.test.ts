import { describe, expect, it, vi } from "vitest";
import {
  clearPersistedOverview,
  loadPersistedOverview,
  persistOverview,
  type OverviewSnapshot,
} from "./overviewSnapshot";

function snapshot(): OverviewSnapshot {
  return {
    stats: {
      nodes: { total: 4, ready: 3 },
      pods: { total: 6, running: 5, pending: 1, other: 0 },
      deployments: 2,
      services: 3,
      namespaces: 4,
      events: { total: 0, normal: 0, warnings: 0, recentWarnings: [] },
    },
    updatedAt: 1_755_000_000_000,
  };
}

describe("loadPersistedOverview", () => {
  it("loads the snapshot via overview_snapshot_load", async () => {
    const invoke = vi.fn().mockResolvedValue(snapshot());

    const loaded = await loadPersistedOverview("kind-dev", invoke);

    expect(invoke).toHaveBeenCalledWith("overview_snapshot_load", { context: "kind-dev" });
    expect(loaded).toEqual(snapshot());
  });

  it("returns null when nothing is persisted", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    expect(await loadPersistedOverview("kind-dev", invoke)).toBeNull();
  });

  it("returns null when the command is unavailable (web mode)", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("unknown command: overview_snapshot_load"));
    expect(await loadPersistedOverview("kind-dev", invoke)).toBeNull();
  });

  it("returns null when the payload has the wrong shape", async () => {
    const invoke = vi.fn().mockResolvedValue({ stats: null, updatedAt: "yesterday" });
    expect(await loadPersistedOverview("kind-dev", invoke)).toBeNull();
  });
});

describe("persistOverview", () => {
  it("saves the snapshot via overview_snapshot_save", async () => {
    const invoke = vi.fn().mockResolvedValue(null);

    await persistOverview("kind-dev", snapshot(), invoke);

    expect(invoke).toHaveBeenCalledWith("overview_snapshot_save", {
      context: "kind-dev",
      snapshot: snapshot(),
    });
  });

  it("swallows command failures", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("unknown command"));
    await expect(persistOverview("kind-dev", snapshot(), invoke)).resolves.toBeUndefined();
  });
});

describe("clearPersistedOverview", () => {
  it("clears one context via overview_snapshot_clear", async () => {
    const invoke = vi.fn().mockResolvedValue(null);

    await clearPersistedOverview("kind-dev", invoke);

    expect(invoke).toHaveBeenCalledWith("overview_snapshot_clear", { context: "kind-dev" });
  });

  it("clears every context when called without one", async () => {
    const invoke = vi.fn().mockResolvedValue(null);

    await clearPersistedOverview(undefined, invoke);

    expect(invoke).toHaveBeenCalledWith("overview_snapshot_clear", { context: null });
  });

  it("swallows command failures", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("unknown command"));
    await expect(clearPersistedOverview("kind-dev", invoke)).resolves.toBeUndefined();
  });
});
