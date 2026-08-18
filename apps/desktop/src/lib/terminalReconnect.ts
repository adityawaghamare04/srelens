/**
 * Pure reconnect policy for terminals, split out from the xterm-wired pane so it
 * can be unit-tested (the pane itself is verified live against a cluster).
 *
 * An exec session isn't resumable, so a reconnect is always a *fresh* session.
 * Only an unexpected drop (a stream error) auto-reconnects; a clean exit — the
 * user typed `exit`, or the process ended — is intentional and waits for a
 * manual reconnect/restart.
 */

/** Why a terminal session ended. */
export type ExitReason = { kind: "closed" } | { kind: "error"; message: string };

/** Connection state of a terminal, driving its status pill and controls. */
export type TermStatus =
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "reconnecting"; attempt: number }
  | { kind: "disconnected"; reason?: string };

/** Backoff before each successive reconnect attempt; length caps the retries. */
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

/**
 * How long a session must stay up to count as having worked.
 *
 * Opening an exec session and *keeping* one are different things: the backend
 * returns a session id as soon as the task is spawned, so a shell that is
 * refused (RBAC, a container that is not running, an image without a shell)
 * still connects successfully and only fails a moment later. Treating that as
 * a healthy connection reset the retry budget every cycle, so the terminal
 * reconnected forever instead of stopping and showing the error (#263).
 */
export const HEALTHY_SESSION_MS = 5000;

/**
 * Whether a session that has just ended earned a fresh retry budget.
 *
 * A shell the user actually used and lost deserves the full backoff schedule
 * again; one that died on arrival does not, or the schedule never runs out.
 */
export function sessionEarnedRetryReset(livedMs: number): boolean {
  return livedMs >= HEALTHY_SESSION_MS;
}

/** Delay before reconnect attempt `attempt` (1-based), or null when exhausted. */
export function reconnectDelayMs(attempt: number): number | null {
  if (attempt < 1 || attempt > RECONNECT_DELAYS_MS.length) return null;
  return RECONNECT_DELAYS_MS[attempt - 1];
}

/**
 * Whether to auto-reconnect after `reason`, given the driver can reopen a
 * session and how many attempts have already been made. Only unexpected errors
 * auto-reconnect, and only while the backoff schedule has retries left.
 */
export function shouldAutoReconnect(
  reason: ExitReason,
  reconnectable: boolean,
  priorAttempts: number,
): boolean {
  if (!reconnectable) return false;
  if (reason.kind !== "error") return false;
  return priorAttempts < RECONNECT_DELAYS_MS.length;
}

/** The next status when a session exits: schedule a reconnect, or disconnect
 *  (surfacing the last error message when there was one). */
export function nextStatusOnExit(
  reason: ExitReason,
  reconnectable: boolean,
  priorAttempts: number,
): TermStatus {
  if (shouldAutoReconnect(reason, reconnectable, priorAttempts)) {
    return { kind: "reconnecting", attempt: priorAttempts + 1 };
  }
  return reason.kind === "error"
    ? { kind: "disconnected", reason: reason.message }
    : { kind: "disconnected" };
}
