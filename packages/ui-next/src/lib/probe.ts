import { useSyncExternalStore } from "react";
import { connectCluster, type ClusterContext, type ClusterInfo } from "@srelens/core";
import { setLink } from "./workspace";

let infos: Record<string, ClusterInfo> = {};
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function getInfo(stableId: string): ClusterInfo | undefined { return infos[stableId]; }
export function resetProbes(): void { infos = {}; emit(); }
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
export function useInfo(stableId: string | null): ClusterInfo | undefined {
  return useSyncExternalStore(subscribe, () => (stableId ? infos[stableId] : undefined), () => undefined);
}

/**
 * Link state is derived, not invented: `connecting` while the call is out,
 * then `connected` from `reachable`, `error` with the backend's message, or
 * `disconnected` when it is unreachable and says nothing more.
 */
export async function probeCluster(ctx: ClusterContext, connect: typeof connectCluster = connectCluster): Promise<void> {
  setLink(ctx.stableId, "connecting");
  const info = await connect(ctx.name);
  infos = { ...infos, [ctx.stableId]: info };
  emit();
  if (info.reachable) setLink(ctx.stableId, "connected");
  else if (info.error) setLink(ctx.stableId, "error", info.error);
  else setLink(ctx.stableId, "disconnected");
}
