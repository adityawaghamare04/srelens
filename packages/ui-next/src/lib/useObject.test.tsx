import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { K8sObject } from "@srelens/core";
import { useObject } from "./useObject";

vi.mock("@srelens/core", () => ({
  getObject: vi.fn(),
}));

import { getObject } from "@srelens/core";

const mockedGetObject = vi.mocked(getObject);

describe("useObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("settles on ready with the object", async () => {
    const object: K8sObject = { kind: "Pod", metadata: { name: "web-1" } };
    mockedGetObject.mockResolvedValueOnce({ object });
    const { result } = renderHook(() => useObject("ctx", "Pod", "default", "web-1"));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.object).toEqual(object);
    expect(result.current.error).toBeUndefined();
  });

  it("settles on error with the message when getObject resolves with an error field", async () => {
    mockedGetObject.mockResolvedValueOnce({ error: "not found" });
    const { result } = renderHook(() => useObject("ctx", "Pod", "default", "missing"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("not found");
    expect(result.current.object).toBeUndefined();
  });

  it("settles on error when getObject's promise rejects rather than resolving with an error field", async () => {
    mockedGetObject.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useObject("ctx", "Pod", "default", "web-1"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("boom");
  });

  it("drops a result that arrives after the target changed", async () => {
    let resolveFirst!: (v: { object?: K8sObject; error?: string }) => void;
    mockedGetObject.mockImplementationOnce(
      () => new Promise((r) => { resolveFirst = r; }),
    );
    const second: K8sObject = { kind: "Pod", metadata: { name: "web-2" } };
    mockedGetObject.mockResolvedValueOnce({ object: second });

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useObject("ctx", "Pod", "default", name),
      { initialProps: { name: "web-1" } },
    );

    rerender({ name: "web-2" });
    await waitFor(() => expect(result.current.object).toEqual(second));

    // The stale first-target promise resolves after the rerender switched
    // targets; it must be dropped, not clobber the now-current object.
    const stale: K8sObject = { kind: "Pod", metadata: { name: "web-1" } };
    await act(async () => {
      resolveFirst({ object: stale });
      await Promise.resolve();
    });
    expect(result.current.object).toEqual(second);
    expect(result.current.status).toBe("ready");
  });

  it("reload() re-fetches", async () => {
    const first: K8sObject = { kind: "Pod", metadata: { name: "web-1", labels: { v: "1" } } };
    const second: K8sObject = { kind: "Pod", metadata: { name: "web-1", labels: { v: "2" } } };
    mockedGetObject.mockResolvedValueOnce({ object: first }).mockResolvedValueOnce({ object: second });

    const { result } = renderHook(() => useObject("ctx", "Pod", "default", "web-1"));
    await waitFor(() => expect(result.current.object).toEqual(first));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.object).toEqual(second));
    expect(mockedGetObject).toHaveBeenCalledTimes(2);
  });
});
