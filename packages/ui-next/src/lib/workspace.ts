import { useSyncExternalStore } from "react";

export type LinkState = "connected" | "connecting" | "disconnected" | "error";

export interface WorkspaceView {
  /** Per cluster. Derived from `ClusterInfo.reachable` and in-flight connects; never persisted. */
  links: Record<string, { state: LinkState; error?: string }>;
  /** Which sidebar sections are open. Not persisted. */
  expanded: string[];
  /**
   * Namespace selection per cluster, keyed by `ClusterContext.stableId`, never
   * a display name. One selection per cluster, shared by every screen looking
   * at that cluster, rather than one per tab. An empty array means "all
   * namespaces", and so does a cluster with no entry at all — a cluster is
   * only ever added here when something narrows it, never seeded up front.
   */
  namespaces: Record<string, string[]>;
}

/**
 * What the current workspace looks like right now, as distinct from what it
 * contains. The tab store owns clusters, tabs and the active cluster and is
 * written to disk; this owns whether each cluster is reachable and which
 * sections are open — neither of which should outlive the window, because a
 * cluster's reachability is a fact about now and an expanded section is a
 * fact about this sitting.
 */
const initial = (): WorkspaceView => ({ links: {}, expanded: [], namespaces: {} });
let view: WorkspaceView = initial();
const listeners = new Set<() => void>();

function emit(next: WorkspaceView) {
  view = next;
  for (const l of listeners) l();
}

/** Order is significant: the sidebar renders sections in the order given. */
function sameArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function isInitial(v: WorkspaceView): boolean {
  return Object.keys(v.links).length === 0 && v.expanded.length === 0 && Object.keys(v.namespaces).length === 0;
}

export function getView(): WorkspaceView {
  return view;
}

/**
 * Whether {@link seedExpandedOnce} has already run for this window's
 * lifetime. Module-level rather than a ref kept on `Nav`: a ref resets every
 * time the component remounts, so a ref-guarded seed cannot tell "nothing has
 * opened a group yet" from "the user just closed all of them" — both show up
 * as an empty `expanded` on the next mount. A flag that survives remounts is
 * what makes the two distinguishable. `resetView` clears it alongside the
 * rest of the view because tests use one call to `resetView` as "a fresh
 * window"; production never calls `resetView` at all.
 */
let seeded = false;

export function resetView(): void {
  seeded = false;
  if (isInitial(view)) return;
  emit(initial());
}

/**
 * Seeds `expanded` with `ids`, but only the first time this is ever called
 * for the running window — not once per mount of whatever calls it. Everything
 * else about the sidebar's folds already works whether `Nav` is mounted once
 * or remounted a dozen times; this is the one piece of it that must not.
 */
export function seedExpandedOnce(ids: string[]): void {
  if (seeded) return;
  seeded = true;
  if (view.expanded.length === 0) setExpanded(ids);
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
  if (sameArray(view.expanded, ids)) return;
  emit({ ...view, expanded: [...ids] });
}

/**
 * Sets a cluster's namespace selection. Per cluster, not per tab: two tabs on
 * the same cluster agree, because both read this same record.
 */
export function setNamespaces(clusterId: string, namespaces: string[]): void {
  const current = view.namespaces[clusterId];
  if (current && sameArray(current, namespaces)) return;
  emit({ ...view, namespaces: { ...view.namespaces, [clusterId]: [...namespaces] } });
}

/** A stable empty selection, so an unset cluster's snapshot never changes identity. */
const NO_NAMESPACES: string[] = [];

/** The cluster's namespace selection, re-rendering whoever reads it when it changes. */
export function useNamespaces(clusterId: string | undefined): string[] {
  return useSyncExternalStore(
    subscribe,
    () => (clusterId === undefined ? NO_NAMESPACES : (view.namespaces[clusterId] ?? NO_NAMESPACES)),
    () => NO_NAMESPACES,
  );
}
