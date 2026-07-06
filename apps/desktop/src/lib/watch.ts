import { invokeCommand, subscribe } from "../transport/transport";

export interface WatchHandle {
  stop: () => void;
}

/** Connection health of a watch. */
export type WatchStatus = "live" | "reconnecting";

/** Resource kinds that support live watching. */
export const WATCHABLE_KINDS = ["pods", "deployments", "services", "events"] as const;

// Monotonic id so each watch gets a unique channel (avoids cross-view mixups).
let watchSeq = 0;

/**
 * Start a live watch for a watchable resource kind. The Rust backend streams
 * full summary snapshots over a Tauri event channel; `onRows` is called with
 * each snapshot. Call `stop()` to unsubscribe and cancel the backend watch.
 *
 * The listener is registered BEFORE the backend watch starts, so the initial
 * snapshot (emitted as soon as the watch's list completes) can't race ahead of
 * the subscription and get lost — which previously left the view stuck loading.
 */
export async function watchResource(
  context: string,
  namespace: string,
  kind: string,
  onRows: (rows: Array<{ name: string }>) => void,
  onStatus?: (status: WatchStatus) => void,
): Promise<WatchHandle> {
  const channel = `watch:${kind}:${context}:${namespace}:${++watchSeq}`;
  const dispose = await subscribe(channel, (payload) => {
    // The backend emits either a snapshot (array) or a `{status}` object.
    if (Array.isArray(payload)) {
      onRows(payload as Array<{ name: string }>);
    } else if (payload && typeof payload === "object" && "status" in payload) {
      onStatus?.((payload as { status: WatchStatus }).status);
    }
  });
  try {
    await invokeCommand("start_resource_watch", { context, namespace, kind, channel });
  } catch (e) {
    dispose();
    throw e;
  }
  return {
    stop: () => {
      dispose();
      void invokeCommand("stop_watch", { channel });
    },
  };
}
