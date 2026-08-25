import { invokeCommand, on } from "../transport/transport";
import { isTauri } from "../transport/platform";
import { describeError } from "./errors";
import { notify } from "./notify";

/** A live port-forward: a local port piped to a Pod or Service. */
export interface ActiveForward {
  id: number;
  context: string;
  namespace: string;
  /** "Pod" or "Service". */
  kind: string;
  name: string;
  remotePort: number;
  localPort: number;
  /** Live state, driven by `forward:status:<id>` events from the backend. */
  status: "active" | "reconnecting" | "failed";
  /** Bytes moved since this forward started, as the backend counts them. A
   *  running total, not a delta: `forward:traffic:<id>` carries the whole
   *  number each time. */
  bytesMoved: number;
  /** Epoch millis, stamped by the backend when the forward was created — for
   *  every forward, including ones this session started, so an age means the
   *  same thing in every row rather than "since I noticed it" in some. */
  startedAt: number;
}

export interface ForwardRequest {
  context: string;
  namespace: string;
  kind: string;
  name: string;
  remotePort: number;
  /** Preferred local port; omitted/0 lets the OS pick a free one. */
  localPort?: number;
}

/** One live forward as `list_forwards` reports it (Rust `ForwardEntry`). */
interface ForwardEntry {
  id: number;
  context: string;
  namespace: string;
  kind: string;
  name: string;
  remotePort: number;
  localPort: number;
  startedAt: number;
  bytes: number;
}

// Module-level store so active forwards survive component remounts and are
// shared between the per-resource "Forward" action and the status-bar list.
let forwards: ActiveForward[] = [];
const listeners = new Set<() => void>();
const closers = new Map<number, () => void>();

// Ids this store has deliberately dropped. A forward that exhausts its retries
// emits `forward:closed:<id>` — which drops the row — but stays in
// `ForwardManager`'s map until `stop` is called, so `list_forwards` keeps
// reporting it. Without this, a rehydrate landing after a give-up would raise a
// dead tunnel back into the table it was just correctly removed from. It also
// covers a `list_forwards` already in flight when a stop lands.
const dropped = new Set<number>();

function emit() {
  for (const l of listeners) l();
}

/** Subscribe to store changes (for `useSyncExternalStore`). */
export function subscribeForwards(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current active forwards (stable reference until the next change). */
export function getForwards(): ActiveForward[] {
  return forwards;
}

/** Start a port-forward and track it; auto-removes if the backend loop ends. */
export async function startPortForward(req: ForwardRequest): Promise<ActiveForward> {
  const info = await invokeCommand<{ id: number; localPort: number; startedAt: number }>(
    "start_port_forward",
    {
      context: req.context,
      namespace: req.namespace,
      kind: req.kind,
      name: req.name,
      remotePort: req.remotePort,
      localPort: req.localPort ?? null,
    },
  );
  // The start response carries its own startedAt now — the same stamp
  // `list_forwards` would report for this forward, taken once on the
  // backend rather than read back with a second call. No follow-up
  // `list_forwards` here: a tunnel that started fine no longer fails on a
  // read that has nothing to do with whether it's running.
  const fwd: ActiveForward = {
    id: info.id,
    context: req.context,
    namespace: req.namespace,
    kind: req.kind,
    name: req.name,
    remotePort: req.remotePort,
    localPort: info.localPort,
    status: "active",
    bytesMoved: 0,
    startedAt: info.startedAt,
  };
  forwards = [...forwards, fwd];
  watchForward(info.id);
  emit();
  return fwd;
}

/** Stop a forward and drop it from the store. */
export async function stopPortForward(id: number): Promise<void> {
  await invokeCommand("stop_port_forward", { id });
  removeForward(id);
}

/**
 * Adopt every forward the backend is still running. This store is module-level
 * and dies with a browser reload; `ForwardManager` does not, so without this a
 * web user reloads into an empty table while their tunnels keep running.
 *
 * A forward the store already knows keeps its existing row — identity included,
 * so a rehydrate on mount doesn't re-render every row — and one it dropped on
 * purpose stays dropped. Resolves even when the listing fails: that failure is
 * reported to the reader, not thrown at a mount effect.
 */
export async function rehydrateForwards(): Promise<void> {
  let entries: ForwardEntry[];
  try {
    entries = await listForwards();
  } catch (e) {
    notify.error("Couldn't list active port forwards", describeError(e).detail);
    return;
  }
  const known = new Set(forwards.map((f) => f.id));
  const added = entries.filter((e) => !known.has(e.id) && !dropped.has(e.id)).map(fromEntry);
  if (added.length === 0) return;
  forwards = [...forwards, ...added];
  for (const f of added) watchForward(f.id);
  emit();
}

/** Where a live port-forward is reachable from the current UI: the bound
 *  localhost port on desktop, or the same-origin `/pf/<id>/` reverse proxy on
 *  web (the container's loopback port isn't reachable from the browser). */
export function forwardUrl(info: { id: number; localPort: number }): string {
  return isTauri() ? `http://localhost:${info.localPort}` : `/pf/${info.id}/`;
}

/** The human-readable, copy-pasteable address of a live forward: the bound
 *  localhost port on desktop, or the absolute same-origin `/pf/<id>/` proxy URL
 *  on web (the container's loopback port isn't reachable from the browser). */
export function forwardAddress(info: { id: number; localPort: number }): string {
  return isTauri()
    ? `localhost:${info.localPort}`
    : `${window.location.origin}/pf/${info.id}/`;
}

async function listForwards(): Promise<ForwardEntry[]> {
  const res = await invokeCommand<{ forwards?: ForwardEntry[] }>("list_forwards");
  return res?.forwards ?? [];
}

/** A backend entry as a store row. A forward the manager still holds is being
 *  served, so it starts `active`; a `forward:status` event corrects that the
 *  moment the tunnel flaps. */
function fromEntry(e: ForwardEntry): ActiveForward {
  return {
    id: e.id,
    context: e.context,
    namespace: e.namespace,
    kind: e.kind,
    name: e.name,
    remotePort: e.remotePort,
    localPort: e.localPort,
    status: "active",
    bytesMoved: e.bytes,
    startedAt: e.startedAt,
  };
}

/** Listen for one forward's closure, status and traffic. Idempotent, so a
 *  rehydrate that re-meets a known forward doesn't subscribe twice. */
function watchForward(id: number) {
  if (closers.has(id)) return;
  const unsubClosed = on(`forward:closed:${id}`, () => removeForward(id));
  const unsubStatus = on(`forward:status:${id}`, (payload) => {
    const state = (payload as { state?: unknown } | null)?.state;
    if (state === "active" || state === "reconnecting" || state === "failed") {
      setForwardStatus(id, state);
    }
  });
  const unsubTraffic = on(`forward:traffic:${id}`, (payload) => {
    const bytes = (payload as { bytes?: unknown } | null)?.bytes;
    if (typeof bytes === "number" && Number.isFinite(bytes)) setForwardBytes(id, bytes);
  });
  closers.set(id, () => {
    unsubClosed();
    unsubStatus();
    unsubTraffic();
  });
}

function setForwardStatus(id: number, status: ActiveForward["status"]) {
  const next = forwards.map((f) => (f.id === id && f.status !== status ? { ...f, status } : f));
  if (next.some((f, i) => f !== forwards[i])) {
    forwards = next;
    emit();
  }
}

/** Record a forward's running byte total. The event fires about once a second,
 *  so an unchanged total must leave both the row and the array identity alone —
 *  otherwise `useSyncExternalStore` wakes every subscriber every second. */
function setForwardBytes(id: number, bytesMoved: number) {
  const next = forwards.map((f) =>
    f.id === id && f.bytesMoved !== bytesMoved ? { ...f, bytesMoved } : f,
  );
  if (next.some((f, i) => f !== forwards[i])) {
    forwards = next;
    emit();
  }
}

function removeForward(id: number) {
  closers.get(id)?.();
  closers.delete(id);
  dropped.add(id);
  const next = forwards.filter((f) => f.id !== id);
  if (next.length !== forwards.length) {
    forwards = next;
    emit();
  }
}

/** Reset the module-level store between tests. */
export function __resetForwardStoreForTests(): void {
  for (const close of closers.values()) close();
  closers.clear();
  dropped.clear();
  forwards = [];
}
