import { describe, it, expect } from "vitest";
import {
  reconnectDelayMs,
  shouldAutoReconnect,
  nextStatusOnExit,
  RECONNECT_DELAYS_MS,
} from "./terminalReconnect";

describe("reconnectDelayMs", () => {
  it("returns the backoff schedule, then null once exhausted", () => {
    expect(reconnectDelayMs(1)).toBe(RECONNECT_DELAYS_MS[0]);
    expect(reconnectDelayMs(RECONNECT_DELAYS_MS.length)).toBe(
      RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1],
    );
    expect(reconnectDelayMs(RECONNECT_DELAYS_MS.length + 1)).toBeNull();
    expect(reconnectDelayMs(0)).toBeNull();
  });
});

describe("shouldAutoReconnect", () => {
  it("auto-reconnects only on an unexpected error, when reconnectable and not exhausted", () => {
    expect(shouldAutoReconnect({ kind: "error", message: "drop" }, true, 0)).toBe(true);
    // Exhausted the schedule → stop.
    expect(shouldAutoReconnect({ kind: "error", message: "drop" }, true, RECONNECT_DELAYS_MS.length)).toBe(false);
    // Clean exit (user typed exit) → never auto.
    expect(shouldAutoReconnect({ kind: "closed" }, true, 0)).toBe(false);
    // Driver can't reopen → never auto.
    expect(shouldAutoReconnect({ kind: "error", message: "drop" }, false, 0)).toBe(false);
  });
});

describe("nextStatusOnExit", () => {
  it("schedules a reconnect on error, otherwise goes disconnected", () => {
    expect(nextStatusOnExit({ kind: "error", message: "x" }, true, 0)).toEqual({
      kind: "reconnecting",
      attempt: 1,
    });
    expect(nextStatusOnExit({ kind: "closed" }, true, 0)).toEqual({ kind: "disconnected" });
    // Exhausted error → disconnected, surfacing the last error message.
    expect(nextStatusOnExit({ kind: "error", message: "boom" }, true, RECONNECT_DELAYS_MS.length)).toEqual({
      kind: "disconnected",
      reason: "boom",
    });
  });
});
