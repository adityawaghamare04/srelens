import { useSyncExternalStore } from "react";

export type LinkState = "connected" | "connecting" | "disconnected" | "error";

export interface WorkspaceView {
  /** Per cluster. Derived from `ClusterInfo.reachable` and in-flight connects; never persisted. */
  links: Record<string, { state: LinkState; error?: string }>;
  /** Which sidebar sections are open. Not persisted. */
  expanded: string[];
}

/**
 * What the current workspace looks like right now, as distinct from what it
 * contains. The tab store owns clusters, tabs and the active cluster and is
 * written to disk; this owns whether each cluster is reachable and which
 * sections are open — neither of which should outlive the window, because a
 * cluster's reachability is a fact about now and an expanded section is a
 * fact about this sitting.
 */
const initial = (): WorkspaceView => ({ links: {}, expanded: [] });
let view: WorkspaceView = initial();
const listeners = new Set<() => void>();

function emit(next: WorkspaceView) {
  view = next;
  for (const l of listeners) l();
}

/** Order is significant: the sidebar renders sections in the order given. */
function sameExpanded(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function isInitial(v: WorkspaceView): boolean {
  return Object.keys(v.links).length === 0 && v.expanded.length === 0;
}

export function getView(): WorkspaceView {
  return view;
}

export function resetView(): void {
  if (isInitial(view)) return;
  emit(initial());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceView(): WorkspaceView {
  return useSyncExternalStore(subscribe, getView, getView);
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
  if (sameExpanded(view.expanded, ids)) return;
  emit({ ...view, expanded: [...ids] });
}
