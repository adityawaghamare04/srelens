import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { LogStatus, LogTarget } from "@srelens/core";

const startLogStream = vi.fn();

vi.mock("@srelens/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@srelens/core")>();
  return {
    ...actual,
    startLogStream: (...args: unknown[]) => startLogStream(...args),
  };
});

// Imported after the mock so the module under test picks up the mocked
// `startLogStream` rather than the real Tauri-backed one.
const { useLogStream } = await import("./logStream");

const target: LogTarget = { pod: "web-1", container: "app", label: "" };
const otherTarget: LogTarget = { pod: "web-2", container: "app", label: "" };

/** A `startLogStream` double whose caller controls when the connect promise
 *  settles and can fire lines/status at will through the captured callbacks. */
function fakeStream() {
  let onLine!: (source: string, line: string) => void;
  let onStatus: ((status: LogStatus) => void) | undefined;
  const stop = vi.fn();
  let resolveConnect!: (v: { stop: () => void }) => void;
  let rejectConnect!: (e: unknown) => void;
  const connectPromise = new Promise<{ stop: () => void }>((resolve, reject) => {
    resolveConnect = resolve;
    rejectConnect = reject;
  });
  startLogStream.mockImplementation(
    (
      _context: string,
      _namespace: string,
      _targets: LogTarget[],
      line: (source: string, line: string) => void,
      status?: (s: LogStatus) => void,
    ) => {
      onLine = line;
      onStatus = status;
      return connectPromise;
    },
  );
  return {
    stop,
    line: (source: string, text: string) => onLine(source, text),
    status: (s: LogStatus) => onStatus?.(s),
    connect: () => act(async () => { resolveConnect({ stop }); await Promise.resolve(); }),
    reject: (e: unknown) => act(async () => { rejectConnect(e); await Promise.resolve(); }),
  };
}

beforeEach(() => {
  startLogStream.mockReset();
});

describe("useLogStream", () => {
  it("lands lines in order", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.connect();

    act(() => {
      s.line("", "one");
      s.line("", "two");
      s.line("", "three");
    });
    await waitFor(() => expect(result.current.lines).toHaveLength(3));
    expect(result.current.lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
  });

  it("lands all hundred lines fired in one tick", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.connect();

    act(() => {
      for (let i = 0; i < 100; i++) s.line("", `line ${i}`);
    });
    await waitFor(() => expect(result.current.lines).toHaveLength(100));
    expect(result.current.lines[0].text).toBe("line 0");
    expect(result.current.lines[99].text).toBe("line 99");
  });

  it("holds the view and counts arrivals while paused", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.connect();

    act(() => s.line("", "before-pause"));
    await waitFor(() => expect(result.current.lines).toHaveLength(1));

    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(true);

    act(() => {
      s.line("", "a");
      s.line("", "b");
      s.line("", "c");
    });
    await waitFor(() => expect(result.current.pendingWhilePaused).toBe(3));
    // The view is frozen: still only the one line that landed before pause.
    expect(result.current.lines).toHaveLength(1);
  });

  it("does not leak a commit into the view when pause lands before it flushes", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.connect();

    // "one" schedules a microtask commit that has not run yet when pause is
    // toggled immediately after, in the same synchronous span.
    act(() => {
      s.line("", "one");
      result.current.togglePause();
    });
    expect(result.current.paused).toBe(true);

    // Flush every pending microtask. If the scheduled commit still lands, the
    // view moves right after pausing — exactly what pause promises not to do.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.lines).toHaveLength(0);
  });

  it("does not re-tail on resume, and folds in what arrived while paused", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.connect();
    expect(startLogStream).toHaveBeenCalledTimes(1);

    act(() => result.current.togglePause());
    act(() => {
      s.line("", "a");
      s.line("", "b");
    });
    await waitFor(() => expect(result.current.pendingWhilePaused).toBe(2));

    act(() => result.current.togglePause());
    expect(result.current.paused).toBe(false);
    expect(startLogStream).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.lines).toHaveLength(2));
    expect(result.current.pendingWhilePaused).toBe(0);
  });

  it("stops the stream on unmount", async () => {
    const s = fakeStream();
    const { unmount } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.connect();

    unmount();
    expect(s.stop).toHaveBeenCalledTimes(1);
  });

  it("stops a stream whose connect promise resolves after unmount", async () => {
    const s = fakeStream();
    const { unmount } = renderHook(() => useLogStream("kind-dev", "default", [target]));

    // Unmount before the connect promise settles — the dangerous window.
    unmount();
    await s.connect();

    expect(s.stop).toHaveBeenCalledTimes(1);
  });

  it("surfaces a status change", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    expect(result.current.status).toBe("connecting");
    await s.connect();
    await waitFor(() => expect(result.current.status).toBe("connecting"));

    act(() => s.status("live"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    act(() => s.status("reconnecting"));
    await waitFor(() => expect(result.current.status).toBe("reconnecting"));
  });

  it("treats an empty target list as a quiet not-yet state, never calling startLogStream or erroring", async () => {
    // Mirrors the real `startLogStream`'s guard (`packages/core/src/lib/logsStream.ts`):
    // it throws a plain string on an empty target list that `describeError`
    // can't classify. If the hook ever called it with `[]`, this mock would
    // reproduce that exact failure.
    startLogStream.mockImplementation(() =>
      Promise.reject(new Error("cannot start live logs without a pod target")),
    );
    const { result } = renderHook(() => useLogStream("kind-dev", "default", []));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(startLogStream).not.toHaveBeenCalled();
    expect(result.current.status).not.toBe("error");
    expect(result.current.error).toBeUndefined();
  });

  it("connects for the first time, not a restart, once targets arrive after starting empty", async () => {
    const s = fakeStream();
    const { result, rerender } = renderHook(
      ({ targets }: { targets: LogTarget[] }) => useLogStream("kind-dev", "default", targets),
      { initialProps: { targets: [] as LogTarget[] } },
    );
    expect(startLogStream).not.toHaveBeenCalled();

    rerender({ targets: [target] });
    await s.connect();

    expect(startLogStream).toHaveBeenCalledTimes(1);
    expect(result.current.restartCount).toBe(0);
  });

  it("does not flap the aggregate status when only one of several targets is reconnecting", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target, otherTarget]));
    await s.connect();

    act(() => s.status("live"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    // One target out of two blips — not enough on its own to call the whole
    // stream down.
    act(() => s.status("reconnecting"));
    expect(result.current.status).toBe("live");

    // It recovers before a second target would also need to report trouble.
    act(() => s.status("live"));
    expect(result.current.status).toBe("live");
  });

  it("flags the stream reconnecting once as many drop signals arrive as it has targets", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target, otherTarget]));
    await s.connect();

    act(() => s.status("live"));
    await waitFor(() => expect(result.current.status).toBe("live"));

    act(() => s.status("reconnecting"));
    expect(result.current.status).toBe("live");
    act(() => s.status("reconnecting"));
    await waitFor(() => expect(result.current.status).toBe("reconnecting"));
  });

  it("surfaces a start failure through describeError", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.reject(new Error("connection refused"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.title).toBe("Can't reach the cluster");
  });

  it("restarts and clears the buffer when targets change, and says so", async () => {
    const s = fakeStream();
    const { result, rerender } = renderHook(
      ({ targets }: { targets: LogTarget[] }) => useLogStream("kind-dev", "default", targets),
      { initialProps: { targets: [target] } },
    );
    await s.connect();
    act(() => s.line("", "before-restart"));
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(result.current.restartCount).toBe(0);

    const s2 = fakeStream();
    rerender({ targets: [otherTarget] });
    await s2.connect();

    await waitFor(() => expect(result.current.restartCount).toBe(1));
    expect(result.current.lines).toHaveLength(0);
    expect(result.current.dropped).toBe(0);
    expect(startLogStream).toHaveBeenCalledTimes(2);
  });

  it("clears the buffer on demand without restarting the stream", async () => {
    const s = fakeStream();
    const { result } = renderHook(() => useLogStream("kind-dev", "default", [target]));
    await s.connect();
    act(() => s.line("", "one"));
    await waitFor(() => expect(result.current.lines).toHaveLength(1));

    act(() => result.current.clear());
    expect(result.current.lines).toHaveLength(0);
    expect(startLogStream).toHaveBeenCalledTimes(1);
  });
});
