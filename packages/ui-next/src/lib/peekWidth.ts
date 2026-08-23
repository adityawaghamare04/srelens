import { useSyncExternalStore } from "react";
import { settingsStorage } from "@srelens/core";
import type { Storage } from "./tabsPersist";

/**
 * How wide the resource list's detail peek is, remembered between launches.
 *
 * The same shape as `lib/marks.ts` and `lib/columnPrefs.ts`, with the smallest
 * payload any of them carries: one number, not one per kind. A width per kind
 * would be a preference the reader has to set 34 times before the app agrees
 * with them, and nobody wants pods and deployments peeked at different widths.
 *
 * Persisted through `settingsStorage` like its two neighbours — the desktop's
 * backend settings file, `localStorage` on the web — and injectable, so tests
 * need a Map and no platform. Every accessor is wrapped: `settingsStorage`
 * falls back to raw `localStorage` when the backend file is unavailable, and
 * `localStorage` throws outright in a WebView with storage disabled. A width
 * that does not survive the session is better than a pane that cannot be
 * dragged.
 */
export const PEEK_WIDTH_KEY = "srelens.next.peekWidth";

/** What the pane opens at before anyone has dragged it: the 22rem it shipped as. */
export const DEFAULT_PEEK_WIDTH = 352;

/**
 * Narrower than this and the pane stops being able to show what it holds:
 * `Inspector`'s tab strip wraps, its facts stack, and the YAML pane turns
 * into one word per line.
 */
export const MIN_PEEK_WIDTH = 260;

/** Wider than this it is no longer a peek at the row, it is the screen. */
export const MAX_PEEK_WIDTH = 640;

/**
 * What the list keeps for itself whatever the peek asks for — roughly a name,
 * a namespace and a status column. The peek's real ceiling is whichever of
 * this and {@link MAX_PEEK_WIDTH} bites first, because a peek wider than the
 * window is a bug the reader can create with the mouse.
 */
export const MIN_LIST_WIDTH = 360;

/** The width, and the bounds it is currently allowed to move between. */
export interface PeekWidth {
  width: number;
  minWidth: number;
  maxWidth: number;
}

const viewport = (): number => (typeof window === "undefined" ? Infinity : window.innerWidth);

/**
 * The bounds the pane can actually honour right now.
 *
 * A window with room for neither hands back a minimum for a maximum rather
 * than a maximum below it: the pane stays legible and the table scrolls
 * inside itself, which is what `min-w-0` on the list's column is there for.
 */
export function peekBounds(width: number = viewport()): { minWidth: number; maxWidth: number } {
  return {
    minWidth: MIN_PEEK_WIDTH,
    maxWidth: Math.max(MIN_PEEK_WIDTH, Math.min(MAX_PEEK_WIDTH, width - MIN_LIST_WIDTH)),
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

/**
 * Anything but a positive, finite number reads as no stored width at all —
 * and the pane opens at its default rather than at `NaN`, which renders as no
 * pane the reader can see.
 */
export function parseStoredPeekWidth(raw: string | null): number | null {
  if (!raw) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof doc !== "number" || !Number.isFinite(doc) || doc <= 0) return null;
  return doc;
}

/**
 * The width the reader chose, held at whatever they dragged it to within the
 * absolute bounds. The *window's* share of the clamp is applied on the way
 * out instead, so a pane squeezed by a small window widens again when the
 * window does rather than having forgotten what it was set to.
 */
let chosen = DEFAULT_PEEK_WIDTH;
const listeners = new Set<() => void>();

/**
 * `peekWidth` composes its answer, so it has to hand back the *same* object
 * every time nothing has changed: `useSyncExternalStore` tears down and
 * re-renders forever on a snapshot that is a fresh object on every read.
 *
 * Compared by value rather than cleared by `emit`, unlike its neighbours,
 * because one of this snapshot's inputs is the window: a resize changes the
 * answer without going through any setter here, so a cache only `emit` can
 * invalidate would hand back a stale ceiling.
 */
let snapshot: PeekWidth = { width: chosen, ...peekBounds() };

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // The window is half of what decides the maximum, so a resize is a change
  // to this store as much as a drag is.
  window.addEventListener("resize", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("resize", listener);
  };
}

/** The peek's width and its current bounds, stable until one of them changes. */
export function peekWidth(): PeekWidth {
  const { minWidth, maxWidth } = peekBounds();
  const width = clamp(chosen, minWidth, maxWidth);
  if (snapshot.width === width && snapshot.minWidth === minWidth && snapshot.maxWidth === maxWidth) {
    return snapshot;
  }
  snapshot = { width, minWidth, maxWidth };
  return snapshot;
}

/**
 * Read the saved width once at boot — and in tests, as often as they like.
 *
 * Guarded like every accessor in `marks.ts`/`columnPrefs.ts`. Boot must reach
 * `setBooted(true)`, so a refusing storage costs the remembered width and
 * nothing else.
 */
export function loadPeekWidth(storage: Storage = settingsStorage): void {
  let stored: number | null = null;
  try {
    stored = parseStoredPeekWidth(storage.getItem(PEEK_WIDTH_KEY));
  } catch (error) {
    console.error("could not read the saved detail width", error);
  }
  chosen = clamp(stored ?? DEFAULT_PEEK_WIDTH, MIN_PEEK_WIDTH, MAX_PEEK_WIDTH);
  emit();
}

/** Mid-drag: the pane follows the pointer, and nothing is written. */
export function setPeekWidth(width: number): void {
  chosen = clamp(width, MIN_PEEK_WIDTH, MAX_PEEK_WIDTH);
  emit();
}

/** The resize settled — this is the one worth keeping. */
export function savePeekWidth(width: number, storage: Storage = settingsStorage): void {
  setPeekWidth(width);
  try {
    storage.setItem(PEEK_WIDTH_KEY, JSON.stringify(chosen));
  } catch (error) {
    // Best-effort, as `settingsStorage` itself is: a width that does not
    // survive the session is better than a width that cannot be set.
    console.error("could not persist the detail width", error);
  }
}

/** The peek's width, re-rendering whoever reads it when it or the window changes. */
export function usePeekWidth(): PeekWidth {
  return useSyncExternalStore(subscribe, peekWidth, peekWidth);
}
