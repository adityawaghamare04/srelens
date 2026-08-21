import { useSyncExternalStore } from "react";
import { CLOSED_CAP, defaultState, makeTab, newId, type Tab, type TabsState, type Workspace } from "./tabs";

/**
 * The tab store: module-level state, one hook, plain functions for actions.
 *
 * Mock-style on purpose — the shell's state lives in ui-next, not in core. What
 * is not the mock's: ids are random rather than counted (see `newId`), the
 * closed list is per workspace rather than global, and nothing here persists
 * or reads persistence. `tabsPersist.ts` subscribes to this store and owns
 * the file; keeping the two apart is what lets this one be tested with no
 * storage at all.
 *
 * Every action returns the workspace it was given when it would change
 * nothing, and `emit` skips an unchanged state, so a no-op never wakes a
 * subscriber — which matters because one of those subscribers writes a file.
 */
let state: TabsState = defaultState([]);
const listeners = new Set<() => void>();

function emit(next: TabsState) {
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function getState(): TabsState {
  return state;
}

/** Replace the whole state — for boot and for tests. */
export function setState(next: TabsState): void {
  emit(next);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentWorkspace(): Workspace {
  return state.workspaces.find((w) => w.id === state.currentId) ?? state.workspaces[0];
}

export function activeRoute(): string {
  const w = currentWorkspace();
  return w.tabs.find((t) => t.id === w.activeId)?.route ?? "/";
}

function patchWorkspace(id: string, patch: (w: Workspace) => Workspace) {
  const at = state.workspaces.findIndex((w) => w.id === id);
  if (at < 0) return;
  const next = patch(state.workspaces[at]);
  // Identity is the signal for "nothing changed" — no new array, no emit.
  if (next === state.workspaces[at]) return;
  const workspaces = state.workspaces.slice();
  workspaces[at] = next;
  emit({ ...state, workspaces });
}

function patchCurrent(patch: (w: Workspace) => Workspace) {
  patchWorkspace(state.currentId, patch);
}

function remember(w: Workspace, dropped: Tab[]): Tab[] {
  return [...dropped, ...w.closed].slice(0, CLOSED_CAP);
}

export function useTabs() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const workspace = s.workspaces.find((w) => w.id === s.currentId) ?? s.workspaces[0];
  return {
    tabs: workspace.tabs,
    activeId: workspace.activeId,
    workspace,
    workspaces: s.workspaces,
    closed: workspace.closed,
  };
}

export function openTab(route: string, opts: { preview?: boolean; clusterName?: string } = {}): void {
  patchCurrent((w) => {
    const existing = w.tabs.find((t) => t.route === route);
    if (existing) {
      // Opening for real promotes a preview; re-previewing leaves it be.
      const tabs =
        !opts.preview && existing.preview
          ? w.tabs.map((t) => (t.id === existing.id ? { ...t, preview: false } : t))
          : w.tabs;
      if (tabs === w.tabs && w.activeId === existing.id) return w;
      return { ...w, tabs, activeId: existing.id };
    }
    const next = makeTab(route, opts);
    const previewAt = w.tabs.findIndex((t) => t.preview);
    const tabs =
      opts.preview && previewAt >= 0 ? w.tabs.map((t, i) => (i === previewAt ? next : t)) : [...w.tabs, next];
    return { ...w, tabs, activeId: next.id };
  });
}

/**
 * Always a new tab, even for a route already open — that is what "new tab" means.
 *
 * Never pinned: `pinned` belongs to the seed home tab that must always be there,
 * not to the route, and `makeTab("/")` — what Cmd+T asks for — would otherwise
 * hand back a tab that every close path refuses.
 */
export function newTab(route = "/", clusterName?: string): void {
  patchCurrent((w) => {
    const t: Tab = { ...makeTab(route, { clusterName }), pinned: false };
    return { ...w, tabs: [...w.tabs, t], activeId: t.id };
  });
}

export function activateTab(id: string): void {
  const w = currentWorkspace();
  if (w.activeId === id || !w.tabs.some((t) => t.id === id)) return;
  patchCurrent((w) => ({ ...w, activeId: id }));
}

export function closeTab(id: string): void {
  const w = currentWorkspace();
  const at = w.tabs.findIndex((t) => t.id === id);
  const tab = w.tabs[at];
  if (!tab || tab.pinned || w.tabs.length === 1) return;
  patchCurrent((w) => {
    const tabs = w.tabs.filter((t) => t.id !== id);
    // The right neighbour takes over, then the left at the end of the strip.
    const activeId = w.activeId === id ? (tabs[Math.min(at, tabs.length - 1)] ?? tabs[0]).id : w.activeId;
    return { ...w, tabs, activeId, closed: remember(w, [tab]) };
  });
}

export function closeOthers(id: string): void {
  patchCurrent((w) => {
    if (!w.tabs.some((t) => t.id === id)) return w;
    const dropped = w.tabs.filter((t) => t.id !== id && !t.pinned);
    if (!dropped.length && w.activeId === id) return w;
    return { ...w, tabs: w.tabs.filter((t) => t.id === id || t.pinned), activeId: id, closed: remember(w, dropped) };
  });
}

export function closeToRight(id: string): void {
  patchCurrent((w) => {
    const at = w.tabs.findIndex((t) => t.id === id);
    if (at < 0) return w;
    const dropped = w.tabs.slice(at + 1).filter((t) => !t.pinned);
    if (!dropped.length && w.activeId === id) return w;
    return { ...w, tabs: w.tabs.filter((t, i) => i <= at || t.pinned), activeId: id, closed: remember(w, dropped) };
  });
}

export function closeAll(): void {
  patchCurrent((w) => {
    const keep = w.tabs.filter((t) => t.pinned);
    const dropped = w.tabs.filter((t) => !t.pinned);
    const tabs = keep.length ? keep : [makeTab("/")];
    if (!dropped.length && w.activeId === tabs[0].id) return w;
    return { ...w, tabs, activeId: tabs[0].id, closed: remember(w, dropped) };
  });
}

export function reopenClosed(): void {
  const w = currentWorkspace();
  const [last, ...rest] = w.closed;
  if (!last) return;
  patchCurrent((w) => {
    const revived = { ...last, id: newId() };
    return { ...w, tabs: [...w.tabs, revived], activeId: revived.id, closed: rest };
  });
}

export function duplicateTab(id: string): void {
  patchCurrent((w) => {
    const at = w.tabs.findIndex((t) => t.id === id);
    if (at < 0) return w;
    const copy: Tab = { ...w.tabs[at], id: newId(), preview: false, pinned: false };
    const tabs = [...w.tabs.slice(0, at + 1), copy, ...w.tabs.slice(at + 1)];
    return { ...w, tabs, activeId: copy.id };
  });
}

export function togglePin(id: string): void {
  patchCurrent((w) => {
    if (!w.tabs.some((t) => t.id === id)) return w;
    return { ...w, tabs: w.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)) };
  });
}

export function cycleTab(delta: 1 | -1): void {
  const w = currentWorkspace();
  const i = w.tabs.findIndex((t) => t.id === w.activeId);
  const next = w.tabs[(i + delta + w.tabs.length) % w.tabs.length];
  if (next) activateTab(next.id);
}

export function selectIndex(n: number): void {
  const tab = currentWorkspace().tabs[n];
  if (tab) activateTab(tab.id);
}

export function switchWorkspace(id: string): void {
  if (id === state.currentId || !state.workspaces.some((w) => w.id === id)) return;
  emit({ ...state, currentId: id });
}

export function createWorkspace(name: string, clusters: string[]): string {
  const home = makeTab("/");
  const w: Workspace = { id: newId(), name, clusters, tabs: [home], activeId: home.id, closed: [] };
  emit({ workspaces: [...state.workspaces, w], currentId: w.id });
  return w.id;
}

export function renameWorkspace(id: string, name: string): void {
  patchWorkspace(id, (w) => (w.name === name ? w : { ...w, name }));
}

export function removeWorkspace(id: string): void {
  if (state.workspaces.length <= 1) return;
  const at = state.workspaces.findIndex((w) => w.id === id);
  if (at < 0) return;
  const workspaces = state.workspaces.filter((w) => w.id !== id);
  const currentId =
    state.currentId === id ? (workspaces[Math.min(at, workspaces.length - 1)] ?? workspaces[0]).id : state.currentId;
  emit({ workspaces, currentId });
}

export function setWorkspaceClusters(id: string, clusters: string[]): void {
  patchWorkspace(id, (w) =>
    w.clusters.length === clusters.length && w.clusters.every((c, i) => c === clusters[i])
      ? w
      : { ...w, clusters: [...clusters] },
  );
}
