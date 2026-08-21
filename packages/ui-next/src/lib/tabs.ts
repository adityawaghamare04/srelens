import type { ClusterContext } from "@srelens/core";
import { describe, type TabKind } from "./routes";

export interface Tab {
  id: string;
  route: string;
  title: string;
  sub?: string;
  kind: TabKind;
  /** A peek, replaced by the next peek — the way an editor previews a file. */
  preview?: boolean;
  /** Cannot be closed. */
  pinned?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  /** `ClusterContext.stableId`s. Never display names — see #265. */
  clusters: string[];
  tabs: Tab[];
  activeId: string;
  /** Recently closed, most recent first, for reopen-closed. */
  closed: Tab[];
}

export interface TabsState {
  workspaces: Workspace[];
  currentId: string;
}

export const CLOSED_CAP = 12;

let seq = 0;

/**
 * Random rather than a counter. The mock used `t${++uid}`, and a counter
 * restarts at zero on reload while the restored tabs keep the ids the last
 * session gave them — so the first tab opened after a restart collided with
 * one already on screen.
 *
 * `randomUUID` is guarded because it is `[SecureContext]`-only: on a plain
 * http origin — web mode on a LAN address — it is simply absent, and the
 * unguarded call threw while this module was still evaluating, so importing
 * `@srelens/ui-next` rejected and the window came up blank with no way back.
 * Core guards the same call in `transport/webTransport.ts`. Uniqueness is all
 * a tab id needs, so the fallback is time, a counter and randomness: unique
 * within a session by the counter, and across sessions by the other two.
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `t-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeTab(route: string, opts: { preview?: boolean; clusterName?: string } = {}): Tab {
  const info = describe(route, opts.clusterName);
  const tab: Tab = { id: newId(), route, title: info.title, kind: info.kind };
  if (info.sub) tab.sub = info.sub;
  if (info.pinned) tab.pinned = true;
  if (opts.preview) tab.preview = true;
  return tab;
}

function homeTab(): Tab {
  return makeTab("/");
}

/**
 * What a first launch gets: one workspace holding every cluster the user has,
 * so the rail is full rather than empty, and one pinned home tab so the strip
 * is never blank.
 */
export function defaultState(contexts: ClusterContext[]): TabsState {
  const home = homeTab();
  const w: Workspace = {
    id: newId(),
    name: "Default",
    clusters: contexts.map((c) => c.stableId),
    tabs: [home],
    activeId: home.id,
    closed: [],
  };
  return { workspaces: [w], currentId: w.id };
}

/**
 * Make a state consistent with the world: every cluster id names a context
 * that exists, every workspace has tabs and an active one among them, the
 * closed list is capped, and there is a current workspace. Returns the input
 * untouched when nothing needed changing, so a caller can compare by identity.
 */
export function reconcile(state: TabsState, contexts: ClusterContext[]): TabsState {
  const known = new Set(contexts.map((c) => c.stableId));
  let changed = false;

  let workspaces = state.workspaces.map((w) => {
    let next = w;
    const clusters = w.clusters.filter((id) => known.has(id));
    if (clusters.length !== w.clusters.length) next = { ...next, clusters };

    let tabs = next.tabs;
    if (tabs.length === 0) tabs = [homeTab()];
    if (tabs !== next.tabs) next = { ...next, tabs };

    if (!tabs.some((t) => t.id === next.activeId)) next = { ...next, activeId: tabs[0].id };

    if (next.closed.length > CLOSED_CAP) next = { ...next, closed: next.closed.slice(0, CLOSED_CAP) };

    if (next !== w) changed = true;
    return next;
  });

  if (workspaces.length === 0) {
    workspaces = defaultState(contexts).workspaces;
    changed = true;
  }

  let currentId = state.currentId;
  if (!workspaces.some((w) => w.id === currentId)) {
    currentId = workspaces[0].id;
    changed = true;
  }

  return changed ? { workspaces, currentId } : state;
}
