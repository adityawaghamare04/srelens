import { describe, it, expect, vi, beforeEach } from "vitest";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import { invokeCapability, on } from "./transport";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

describe("transport", () => {
  it("invokeCapability forwards id+input to the tauri command", async () => {
    invokeMock.mockResolvedValue({ pong: "hi" });
    const out = await invokeCapability<{ pong: string }>("ping", "hi");
    expect(invokeMock).toHaveBeenCalledWith("invoke_capability", { id: "ping", input: "hi" });
    expect(out).toEqual({ pong: "hi" });
  });

  it("on subscribes and returns a disposer", async () => {
    const flush = () => new Promise<void>((r) => setTimeout(r, 0));
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const handler = vi.fn();
    const dispose = on("catalog:changed", handler);
    await flush();
    expect(listenMock).toHaveBeenCalledWith("catalog:changed", expect.any(Function));
    dispose();
    await flush();
    expect(unlisten).toHaveBeenCalled();
  });
});
