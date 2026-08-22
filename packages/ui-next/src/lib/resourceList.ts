import { useCallback, useEffect, useRef, useState } from "react";
import { watchResource, type WatchHandle, type WatchStatus } from "@srelens/core";
import type { KindDescriptor, ListRow } from "./kinds/types";

export type ResourceListStatus = "loading" | "ready" | "empty" | "error";

export interface ResourceList<Row> {
  rows: Row[];
  status: ResourceListStatus;
  error?: string;
  watch: WatchStatus;
  reload(): void;
}

const POLL_MS = 5000;
const CACHE_LIMIT = 40;

// Memory-only, view-keyed row cache. Capped at CACHE_LIMIT entries, evicting
// the oldest on insert. Never persisted (R-6) — a cache that survived a
// restart would show a cluster's old workloads before its real ones.
let rowCache = new Map<string, unknown[]>();

function cacheGet(key: string): unknown[] | undefined {
  return rowCache.get(key);
}

function cacheSet(key: string, rows: unknown[]) {
  if (!rowCache.has(key) && rowCache.size >= CACHE_LIMIT) {
    const oldest = rowCache.keys().next().value;
    if (oldest !== undefined) rowCache.delete(oldest);
  }
  // Re-insert to keep the key fresh in insertion order (Map preserves it).
  rowCache.delete(key);
  rowCache.set(key, rows);
}

/** Test-only: clear the module-level cache between test cases. */
export function resetListCache() {
  rowCache = new Map();
}

function viewKey(context: string, namespace: string, kind: string) {
  return `${context}|${namespace}|${kind}`;
}

function deriveStatus(rows: unknown[], error: string | undefined, loading: boolean): ResourceListStatus {
  if (loading) return "loading";
  if (error) return rows.length > 0 ? "ready" : "error";
  return rows.length === 0 ? "empty" : "ready";
}

/**
 * The data engine for a resource-list screen: watch vs poll, a view-keyed row
 * cache, and cancellation, with no knowledge of columns or layout. Follows
 * the generation-counter pattern from useResource — a result that arrives
 * after the view changed or the component unmounted is dropped by comparing
 * a captured generation against the current one.
 */
export function useResourceList<Row extends ListRow>(
  context: string,
  kind: string,
  descriptor: KindDescriptor<Row> | undefined,
  namespace: string,
  files: string[],
): ResourceList<Row> {
  const key = viewKey(context, namespace, kind);
  const gen = useRef(0);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const [state, setState] = useState<{ rows: unknown[]; error?: string; loading: boolean; watch: WatchStatus }>(() => {
    const cached = cacheGet(key);
    return { rows: cached ?? [], error: undefined, loading: cached === undefined, watch: "live" };
  });

  useEffect(() => {
    const mine = ++gen.current;
    const cached = cacheGet(key);
    setState({ rows: cached ?? [], error: undefined, loading: cached === undefined, watch: "live" });

    if (!descriptor) {
      return;
    }

    if (descriptor.source === "watch") {
      let handle: WatchHandle | undefined;
      let stopped = false;

      watchResource(
        context,
        namespace,
        kind,
        (rows) => {
          if (gen.current !== mine) return;
          cacheSet(key, rows);
          setState((s) => ({ ...s, rows, loading: false }));
        },
        (status) => {
          if (gen.current !== mine) return;
          setState((s) => ({ ...s, watch: status }));
        },
        (error) => {
          if (gen.current !== mine) return;
          setState((s) => ({ ...s, error, loading: false }));
        },
        files,
      ).then(
        (h) => {
          if (stopped || gen.current !== mine) {
            // A handle that resolves after cleanup is stopped immediately
            // rather than leaked.
            h.stop();
            return;
          }
          handle = h;
        },
        (e: unknown) => {
          // A failed watch start (e.g. the backend's invokeCommand rejects)
          // must surface as `error`, not leave the hook on `loading`
          // forever — errors are returned, never thrown.
          if (gen.current !== mine) return;
          setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false }));
        },
      );

      return () => {
        if (gen.current === mine) gen.current++;
        stopped = true;
        handle?.stop();
      };
    }

    // source: "poll"
    const load = descriptor.load;
    const runPoll = () => {
      if (!load) return;
      load(context, namespace).then(
        (result) => {
          if (gen.current !== mine) return;
          if (result.error) {
            setState((s) => ({ ...s, error: result.error, loading: false }));
            return;
          }
          const rows = result.rows ?? [];
          cacheSet(key, rows);
          setState((s) => ({ ...s, rows, error: undefined, loading: false }));
        },
        (e: unknown) => {
          if (gen.current !== mine) return;
          setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false }));
        },
      );
    };
    runPoll();
    const interval = setInterval(runPoll, POLL_MS);

    return () => {
      if (gen.current === mine) gen.current++;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, namespace, kind, descriptor, tick, files.join(",")]);

  return {
    rows: state.rows as Row[],
    status: deriveStatus(state.rows, state.error, state.loading),
    error: state.error,
    watch: state.watch,
    reload,
  };
}
