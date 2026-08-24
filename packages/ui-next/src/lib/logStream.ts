import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendLogLines,
  clearLogBuffer,
  createLogBuffer,
  describeError,
  startLogStream,
  type FriendlyError,
  type LogLine,
  type LogStatus,
  type LogStreamOptions,
  type LogTarget,
} from "@srelens/core";

/**
 * The hook the Logs screen sits on: it owns the buffer, the connection
 * status, and pause/clear controls, so the screen only has to render what
 * this returns.
 *
 * **Whose job is subject resolution.** `resolveLogSubject` (`./logSubject`)
 * is a one-shot async lookup, not a subscription — the screen calls it,
 * settles on a concrete `LogTarget[]`, and hands that array to this hook.
 * This hook never resolves a subject itself: its only input is targets that
 * are already known to be complete, because `startLogStream` cannot be
 * un-opened once a container's lines have been silently dropped by an
 * incomplete list.
 *
 * **Why the buffer lives in a ref, not `useState`.** `LogBuffer` is an
 * immutable value with pure functions on it (`packages/core/src/lib/logBuffer.ts`),
 * built so a caller holding it in a mutable slot can reassign that slot from
 * a stream callback that fires many times in one tick, and only read the
 * result once at the end. `onLine` does exactly that: it mutates
 * `bufferRef.current` synchronously on every call — never dropping a line to
 * a stale closure, no matter how many arrive before React gets a turn — and
 * schedules a single microtask to fold the ref into render state once the
 * burst has finished. A hundred lines fired in one tick land as one commit,
 * not a race between a hundred `setState` closures.
 *
 * **Pause freezes the view, not the stream.** The design's toggle only
 * relabels a button; classic tears the stream down and re-tails on resume,
 * losing whatever happened in the gap. Neither suits watching something
 * fail. Here, `bufferRef` keeps accumulating while paused — nothing further
 * arrives while the reader isn't looking is EVER dropped except by the
 * ring's own capacity — but the rendered `lines` snapshot is not refreshed
 * from it until resume, and `pendingWhilePaused` counts what arrived in the
 * meantime. Resume folds the buffer into view and resets that count; it
 * never touches the connection, so it can never cause a re-tail.
 *
 * **The unmount race `startLogStream` opens.** `startLogStream` is async: it
 * awaits an `invokeCommand` before its promise resolves. If the component
 * unmounts in that window, a naive `useEffect` would store the resolved
 * `{ stop }` into a ref that nothing reads again — a live subscription with
 * no owner left to stop it. The effect's cleanup instead sets a local
 * `cancelled` flag; the promise's resolve handler checks it and calls
 * `stream.stop()` itself when the mount lost the race, instead of stashing
 * the handle for a cleanup that already ran.
 *
 * **Restarts are unavoidable and must not be silent.** Changing targets, the
 * since window or the tail length has to reopen the stream — there is no
 * live way to add a target the backend didn't tail from the start — and that
 * costs the reader their scrollback. `restartCount` increments on every such
 * restart after the first connect (never on the initial mount, which has
 * nothing to lose, and never on pause/resume or a manual `clear()`, neither
 * of which reopens the stream) so the screen can say "scrollback cleared"
 * instead of quietly emptying the pane.
 */

export interface UseLogStreamOptions extends LogStreamOptions {
  /** How many lines the ring keeps before dropping the oldest. */
  capacity?: number;
}

/** Connection health, plus the states `startLogStream` itself can't report:
 *  `"connecting"` before the first status or failure, and `"error"` when the
 *  connect promise rejected. */
export type LogStreamStatus = "connecting" | LogStatus | "error";

export interface UseLogStreamResult {
  /** The visible lines, oldest first — frozen while `paused` is true. */
  lines: readonly LogLine[];
  /** How many lines the ring has dropped from the visible buffer. */
  dropped: number;
  status: LogStreamStatus;
  /** Set when `status` is `"error"` — why the stream could not be opened. */
  error?: FriendlyError;
  paused: boolean;
  /** Lines that have arrived since pausing, not yet folded into `lines`. */
  pendingWhilePaused: number;
  togglePause: () => void;
  /** Empty the buffer and view without touching the connection. */
  clear: () => void;
  /**
   * Bumped every time a target/since/tailLines change forces a restart after
   * the first connect. A screen watching this rise is how it knows to say
   * scrollback was cleared, rather than the clear passing unremarked.
   */
  restartCount: number;
}

const DEFAULT_CAPACITY = 5000;

/** A stable key for a target list, so the connection effect restarts on what
 *  a target list actually MEANS rather than on a new array identity a
 *  caller might pass every render. */
function targetsKey(targets: readonly LogTarget[]): string {
  return targets.map((t) => `${t.pod}|${t.container ?? ""}|${t.label ?? ""}`).join(",");
}

export function useLogStream(
  context: string,
  namespace: string,
  targets: readonly LogTarget[],
  options: UseLogStreamOptions = {},
): UseLogStreamResult {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const timestamps = options.timestamps ?? false;
  const sinceSeconds = options.sinceSeconds;
  const tailLines = options.tailLines;
  const key = targetsKey(targets);

  const bufferRef = useRef(createLogBuffer(capacity));
  const pausedRef = useRef(false);
  const pendingRef = useRef(0);
  const flushScheduledRef = useRef(false);
  const firstRunRef = useRef(true);

  const [view, setView] = useState(() => bufferRef.current);
  const [paused, setPaused] = useState(false);
  const [pendingWhilePaused, setPendingWhilePaused] = useState(0);
  const [status, setStatus] = useState<LogStreamStatus>("connecting");
  const [error, setError] = useState<FriendlyError | undefined>(undefined);
  const [restartCount, setRestartCount] = useState(0);

  const commit = useCallback(() => {
    flushScheduledRef.current = false;
    if (pausedRef.current) return;
    setView(bufferRef.current);
  }, []);

  const scheduleCommit = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    void Promise.resolve().then(commit);
  }, [commit]);

  // Stable across restarts: the same ref keeps accumulating, so a target
  // change doesn't need a new callback, only a fresh buffer (below).
  const onLine = useCallback(
    (source: string, text: string) => {
      bufferRef.current = appendLogLines(bufferRef.current, [{ source, text }]);
      if (pausedRef.current) {
        pendingRef.current += 1;
        setPendingWhilePaused(pendingRef.current);
      } else {
        scheduleCommit();
      }
    },
    [scheduleCommit],
  );

  const togglePause = useCallback(() => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (!next) {
      // Resuming folds the accumulated buffer into view in one step — never
      // a re-tail, since the connection is untouched by this branch.
      pendingRef.current = 0;
      setPendingWhilePaused(0);
      setView(bufferRef.current);
    }
  }, []);

  const clear = useCallback(() => {
    bufferRef.current = clearLogBuffer(bufferRef.current);
    pendingRef.current = 0;
    setPendingWhilePaused(0);
    setView(bufferRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stopFn: (() => void) | undefined;

    bufferRef.current = createLogBuffer(capacity);
    pendingRef.current = 0;
    setPendingWhilePaused(0);
    setView(bufferRef.current);
    setStatus("connecting");
    setError(undefined);
    if (!firstRunRef.current) {
      setRestartCount((c) => c + 1);
    }
    firstRunRef.current = false;

    const streamTargets: LogTarget[] = targets.map((t) => ({ ...t }));

    startLogStream(
      context,
      namespace,
      streamTargets,
      onLine,
      (s) => {
        if (!cancelled) setStatus(s);
      },
      { timestamps, sinceSeconds, tailLines },
    ).then(
      (stream) => {
        // The dangerous window: this component (or this connection's
        // dependencies) went away between the call and the promise
        // resolving. Nothing else is left to stop the subscription that was
        // just created, so this branch stops it itself instead of storing a
        // handle a cleanup that already ran will never read.
        if (cancelled) {
          stream.stop();
          return;
        }
        stopFn = stream.stop;
      },
      (e: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(describeError(e));
      },
    );

    return () => {
      cancelled = true;
      stopFn?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, namespace, key, sinceSeconds, tailLines, timestamps, capacity, onLine]);

  return useMemo(
    () => ({
      lines: view.lines,
      dropped: view.dropped,
      status,
      error,
      paused,
      pendingWhilePaused,
      togglePause,
      clear,
      restartCount,
    }),
    [view, status, error, paused, pendingWhilePaused, togglePause, clear, restartCount],
  );
}
