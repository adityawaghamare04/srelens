import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** A function that invokes a backend capability — injectable for testing. */
export type Invoker = <T>(id: string, input?: unknown) => Promise<T>;

/** Request/response to a backend capability. */
export async function invokeCapability<T>(id: string, input: unknown = null): Promise<T> {
  return invoke<T>("invoke_capability", { id, input });
}

/** Invoke a raw Tauri command (for streaming primitives like watches). */
export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

/** Subscribe to a broadcast event (mirrors ipcRendererOn / broadcastMessage). */
export function on(channel: string, handler: (payload: unknown) => void): () => void {
  const unlistenPromise = listen(channel, (event) => handler(event.payload));
  let disposed = false;
  unlistenPromise.then((un) => {
    if (disposed) un();
  });
  return () => {
    disposed = true;
    unlistenPromise.then((un) => un());
  };
}

/**
 * Subscribe and await registration before resolving. Use this (not `on`) when
 * the backend starts emitting as soon as it's invoked: subscribe first, then
 * start the producer, so the initial emission can't race ahead of the listener.
 */
export async function subscribe(
  channel: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  return listen(channel, (event) => handler(event.payload));
}
