import { useSyncExternalStore } from "react";

export type LinkState = "connected" | "connecting" | "disconnected" | "error";

export interface WorkspaceView {
  /** The cluster the sidebar and status bar are about. A `stableId`. */
  activeCluster: string | null;
  /** Per cluster. Derived from `ClusterInfo.reachable` and in-flight connects; never persisted. */
  links: Record<string, { state: LinkState; error?: string }>;
  /** Which sidebar sections are open. Not persisted. */
  expanded: string[];
}

/**
 * What the current workspace looks like right now, as distinct from what it
 * contains. The tab store owns clusters and tabs and is written to disk; this
 * owns the active cluster, whether each cluster is reachable, and which
 * sections are open — none of which should outlive the window, because a
 * cluster's reachability is a fact about now and an expanded section is a
 * fact about this sitting.
 */
const initial = (): WorkspaceView => ({ activeCluster: null, links: {}, expanded: [] });
let view: WorkspaceView = initial();
const listeners = new Set<() => void>();

function emit(next: WorkspaceView) {
  if (next === view) return;
  view = next;
  for (const l of listeners) l();
}

export function getView(): WorkspaceView {
  return view;
}

export function resetView(): void {
  emit(initial());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceView(): WorkspaceView {
  return useSyncExternalStore(subscribe, getView, getView);
}

export function setActiveCluster(id: string | null): void {
  if (view.activeCluster === id) return;
  emit({ ...view, activeCluster: id });
}

export function setLink(id: string, state: LinkState, error?: string): void {
  const current = view.links[id];
  if (current && current.state === state && current.error === error) return;
  const entry = error === undefined ? { state } : { state, error };
  emit({ ...view, links: { ...view.links, [id]: entry } });
}

export function toggleExpanded(id: string): void {
  const expanded = view.expanded.includes(id) ? view.expanded.filter((x) => x !== id) : [...view.expanded, id];
  emit({ ...view, expanded });
}

export function setExpanded(ids: string[]): void {
  emit({ ...view, expanded: [...ids] });
}
