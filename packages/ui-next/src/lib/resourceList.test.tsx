import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// `vi.hoisted` because `vi.mock` is hoisted above every declaration in the
// file — a plain `const watchResource = vi.fn(...)` below it would be read
// before it's initialized (see AppLog.test.tsx / Window.test.tsx for the
// same pattern elsewhere in this package).
const { stop, watchResource, mockState } = vi.hoisted(() => {
  const mockState: {
    emitRows: ((rows: unknown[]) => void) | null;
    emitStatus: ((s: string) => void) | null;
  } = { emitRows: null, emitStatus: null };
  const stop = vi.fn();
  const watchResource = vi.fn(
    async (
      _context: string,
      _namespace: string,
      _kind: string,
      onRows: (rows: unknown[]) => void,
      onStatus: (s: string) => void,
    ) => {
      mockState.emitRows = onRows;
      mockState.emitStatus = onStatus;
      return { stop };
    },
  );
  return { stop, watchResource, mockState };
});
vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  watchResource,
}));

import { useResourceList, resetListCache } from "./resourceList";
import type { KindDescriptor, ListRow } from "./kinds/types";

// Typed via an explicit annotation, not `as const`: an `as const` object
// literal narrows its array properties to `readonly`, which then can't
// satisfy `KindDescriptor`'s mutable `columns: Column<Row>[]`. Annotating
// the variable instead gives every field its literal type (e.g. `"watch"`,
// not `string`) without that mismatch.
const watched: KindDescriptor<ListRow> = { k8sKind: "Pod", columns: [], source: "watch", scope: "namespaced", actions: {} };

describe("useResourceList", () => {
  beforeEach(() => {
    resetListCache();
    vi.clearAllMocks();
    mockState.emitRows = null;
    mockState.emitStatus = null;
  });

  it("starts on loading and settles on the first snapshot", async () => {
    const { result } = renderHook(() => useResourceList("prod", "pods", watched, "default", []));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(mockState.emitRows).not.toBeNull());
    act(() => mockState.emitRows!([{ name: "a" }]));
    expect(result.current.status).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
  });

  it("says empty, not ready, when the kind has none — the states differ to a reader", async () => {
    const { result } = renderHook(() => useResourceList("prod", "pods", watched, "default", []));
    await waitFor(() => expect(mockState.emitRows).not.toBeNull());
    act(() => mockState.emitRows!([]));
    expect(result.current.status).toBe("empty");
  });

  it("reports a reconnecting watch without emptying the table", async () => {
    const { result } = renderHook(() => useResourceList("prod", "pods", watched, "default", []));
    await waitFor(() => expect(mockState.emitRows).not.toBeNull());
    act(() => mockState.emitRows!([{ name: "a" }]));
    act(() => mockState.emitStatus!("reconnecting"));
    expect(result.current.watch).toBe("reconnecting");
    expect(result.current.rows).toHaveLength(1);
  });

  it("stops the old watch before the new view starts one", async () => {
    const { rerender } = renderHook((p: { ns: string }) => useResourceList("prod", "pods", watched, p.ns, []), {
      initialProps: { ns: "default" },
    });
    await waitFor(() => expect(watchResource).toHaveBeenCalledTimes(1));
    rerender({ ns: "kube-system" });
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(watchResource).toHaveBeenCalledTimes(2);
  });

  it("drops a snapshot that arrives after the view changed", async () => {
    const { result, rerender } = renderHook((p: { ns: string }) => useResourceList("prod", "pods", watched, p.ns, []), {
      initialProps: { ns: "default" },
    });
    await waitFor(() => expect(mockState.emitRows).not.toBeNull());
    const stale = mockState.emitRows!;
    rerender({ ns: "kube-system" });
    act(() => stale([{ name: "from-the-old-namespace" }]));
    expect(result.current.rows).toHaveLength(0);
  });

  it("paints the cached rows on a remount instead of flashing empty", async () => {
    const first = renderHook(() => useResourceList("prod", "pods", watched, "default", []));
    await waitFor(() => expect(mockState.emitRows).not.toBeNull());
    act(() => mockState.emitRows!([{ name: "a" }]));
    first.unmount();
    const second = renderHook(() => useResourceList("prod", "pods", watched, "default", []));
    expect(second.result.current.rows).toHaveLength(1);
  });

  it("keeps the cached rows when a poll fails, and says why above them", async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ rows: [{ name: "a" }] })
      .mockResolvedValueOnce({ error: "connection refused" });
    const polled: KindDescriptor<ListRow> = { ...watched, source: "poll", load };
    const { result } = renderHook(() => useResourceList("prod", "leases", polled, "default", []));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe("connection refused"));
    expect(result.current.rows).toHaveLength(1);
  });
});
