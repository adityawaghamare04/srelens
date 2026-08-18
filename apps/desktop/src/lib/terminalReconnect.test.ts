import { describe, it, expect } from "vitest";
import {
  sessionEarnedRetryReset,
  HEALTHY_SESSION_MS,
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

describe("sessionEarnedRetryReset", () => {
  it("does not reward a session that died on arrival", () => {
    // The #263 loop: the backend returns a session id as soon as the task is
    // spawned, so a shell that is refused still "connects". Resetting the
    // budget on that meant reconnecting forever instead of reporting the
    // error.
    expect(sessionEarnedRetryReset(0)).toBe(false);
    expect(sessionEarnedRetryReset(200)).toBe(false);
    expect(sessionEarnedRetryReset(HEALTHY_SESSION_MS - 1)).toBe(false);
  });

  it("rewards a session the user actually had", () => {
    expect(sessionEarnedRetryReset(HEALTHY_SESSION_MS)).toBe(true);
    expect(sessionEarnedRetryReset(60_000)).toBe(true);
  });

  it("exhausts the schedule when every attempt dies immediately", () => {
    // Walk the real policy: without a reset, attempts climb and stop.
    let attempt = 0;
    const statuses: string[] = [];
    for (let i = 0; i < RECONNECT_DELAYS_MS.length + 1; i++) {
      if (sessionEarnedRetryReset(50)) attempt = 0;
      const next = nextStatusOnExit({ kind: "error", message: "boom" }, true, attempt);
      statuses.push(next.kind);
      if (next.kind === "reconnecting") attempt = next.attempt;
    }
    expect(statuses.filter((s) => s === "reconnecting")).toHaveLength(RECONNECT_DELAYS_MS.length);
    expect(statuses.at(-1)).toBe("disconnected");
  });

  it("keeps retrying indefinitely if a healthy session keeps dropping", () => {
    // The behaviour we still want: a working shell that loses its connection
    // gets the full schedule again each time.
    let attempt = 0;
    for (let i = 0; i < 20; i++) {
      if (sessionEarnedRetryReset(30_000)) attempt = 0;
      const next = nextStatusOnExit({ kind: "error", message: "drop" }, true, attempt);
      expect(next.kind).toBe("reconnecting");
      if (next.kind === "reconnecting") attempt = next.attempt;
    }
  });
});
