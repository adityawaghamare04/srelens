// Typed wrappers for the overview-snapshot commands (backend:
// `overview_snapshot.rs`, issue #148) — disk persistence for the cluster
// overview so a cold start paints the last known counts instantly.
//
// The backend treats `stats` as opaque JSON: this module owns the shape.
// Every wrapper degrades to a no-op on failure — in web mode the commands
// don't exist ("unknown command"), and a broken cache must never break the
// overview itself.
import { invokeCommand } from "../transport/transport";

/** Cluster overview counts, as shown on the dashboard tiles. */
export interface OverviewStats {
  nodes: { total: number; ready: number };
  pods: { total: number; running: number; pending: number; other: number };
  deployments: number;
  services: number;
  namespaces: number;
  events: { total: number; normal: number; warnings: number; recentWarnings: string[] };
}

/** A point-in-time overview, persisted so a cold start can render instantly. */
export interface OverviewSnapshot {
  stats: OverviewStats;
  updatedAt: number;
}

/** A command invoker — injectable for testing. */
type Invoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Last persisted snapshot for a context, or null if absent or unavailable. */
export async function loadPersistedOverview(
  context: string,
  invoke: Invoker = invokeCommand,
): Promise<OverviewSnapshot | null> {
  try {
    const out = await invoke<OverviewSnapshot | null>("overview_snapshot_load", { context });
    if (!out || typeof out !== "object") return null;
    if (!out.stats || typeof out.stats !== "object") return null;
    if (typeof out.updatedAt !== "number") return null;
    return out;
  } catch {
    return null;
  }
}

/** Persist a context's snapshot for the next cold start (best-effort). */
export async function persistOverview(
  context: string,
  snapshot: OverviewSnapshot,
  invoke: Invoker = invokeCommand,
): Promise<void> {
  try {
    await invoke("overview_snapshot_save", { context, snapshot });
  } catch {
    // web mode / storage failure — the overview works without the cache
  }
}

/** Drop the persisted snapshot for one context, or all of them (best-effort). */
export async function clearPersistedOverview(
  context?: string,
  invoke: Invoker = invokeCommand,
): Promise<void> {
  try {
    await invoke("overview_snapshot_clear", { context: context ?? null });
  } catch {
    // web mode / storage failure — nothing to clear
  }
}
