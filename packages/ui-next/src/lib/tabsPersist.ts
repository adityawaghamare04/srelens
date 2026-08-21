import { loadRestoreSession, settingsStorage } from "@srelens/core";
import type { Tab, TabsState, Workspace } from "./tabs";

/**
 * Where the shell's tabs live between launches.
 *
 * Through `settingsStorage`, not `localStorage`: on the desktop that is the
 * backend's settings file, and on the web it is `localStorage` — one code
 * path, the same one classic's session restore uses. Storage is injectable so
 * this can be tested with a Map and no platform at all, the way core's
 * `listContexts` takes its invoker.
 */
export const STORAGE_KEY = "srelens.next.workspaces";
export const STORAGE_VERSION = 1;

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, raw: string): void;
  removeItem(key: string): void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

function parseTab(v: unknown): Tab | null {
  if (!isRecord(v) || !isString(v.id) || !isString(v.route) || !isString(v.title) || !isString(v.kind)) return null;
  const tab: Tab = { id: v.id, route: v.route, title: v.title, kind: v.kind as Tab["kind"] };
  if (isString(v.sub)) tab.sub = v.sub;
  if (v.preview === true) tab.preview = true;
  if (v.pinned === true) tab.pinned = true;
  return tab;
}

function parseWorkspace(v: unknown): Workspace | null {
  if (!isRecord(v) || !isString(v.id) || !isString(v.name) || !isString(v.activeId)) return null;
  if (!Array.isArray(v.clusters) || !Array.isArray(v.tabs)) return null;
  const tabs = v.tabs.map(parseTab).filter((t): t is Tab => t !== null);
  const closed = Array.isArray(v.closed) ? v.closed.map(parseTab).filter((t): t is Tab => t !== null) : [];
  return {
    id: v.id,
    name: v.name,
    clusters: v.clusters.filter(isString),
    tabs,
    activeId: v.activeId,
    closed,
  };
}

/**
 * A stored document, or null for anything that is not exactly one this build
 * wrote. A newer version is refused whole rather than half-read: applying the
 * fields we recognise and dropping the rest would leave the user with some
 * of their tabs and no idea which. Unknown fields on a current-version
 * document are dropped; malformed tabs are dropped individually, since one
 * bad tab is not a reason to lose the workspace around it.
 */
export function parseStoredState(raw: string | null): TabsState | null {
  if (!raw) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(doc) || doc.version !== STORAGE_VERSION) return null;
  if (!Array.isArray(doc.workspaces) || !isString(doc.currentId)) return null;
  const workspaces = doc.workspaces.map(parseWorkspace).filter((w): w is Workspace => w !== null);
  return { workspaces, currentId: doc.currentId };
}

export function loadTabsState(storage: Storage = settingsStorage, restore: () => boolean = loadRestoreSession): TabsState | null {
  if (!restore()) return null;
  return parseStoredState(storage.getItem(STORAGE_KEY));
}

export function saveTabsState(state: TabsState, storage: Storage = settingsStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...state }));
}

let pending: { state: TabsState; storage: Storage } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Save soon, coalescing a burst of changes into one write of the latest. */
export function scheduleSave(state: TabsState, storage: Storage = settingsStorage, delayMs = 300): void {
  pending = { state, storage };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSave, delayMs);
}

/** Write whatever is pending now. Safe to call with nothing pending. */
export function flushSave(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending) return;
  const { state, storage } = pending;
  pending = null;
  saveTabsState(state, storage);
}

/** A debounced save must not lose the last change to a window closing. */
export function installFlushOnUnload(target: Window = window): () => void {
  target.addEventListener("beforeunload", flushSave);
  return () => target.removeEventListener("beforeunload", flushSave);
}
