import { useSyncExternalStore } from "react";
import type { ClusterContext } from "@srelens/core";
import { useActiveCluster } from "./tabsStore";

/**
 * The cluster contexts this window knows about.
 *
 * Workspaces hold `ClusterContext.stableId`s (#265); core's `list*`,
 * `watchResource` and `useNamespaceOptions` all take a context *name*. Screens
 * receive only `{ route }` and read their state from stores, so without this
 * there is nowhere for a screen to make that translation — `Window` held the
 * list in `useState` and passed it as props to the two components that needed
 * it.
 *
 * `Window` is still the only writer; it sets this from the same `listContexts`
 * call it already makes, and reads it back rather than keeping a second copy.
 */
let contexts: ClusterContext[] = [];
const listeners = new Set<() => void>();

export function getContexts(): ClusterContext[] {
  return contexts;
}

export function setContexts(next: ClusterContext[]): void {
  contexts = next;
  for (const listener of listeners) listener();
}

/**
 * The kubeconfig files the backend must know about before a client can be built
 * for a context that came from one of them. Resolved once at boot and read by
 * every core call that takes them.
 */
let files: string[] = [];

export function setKubeconfigFiles(next: string[]): void {
  files = next;
}

export function getKubeconfigFiles(): string[] {
  return files;
}

/** Test-only: put the store back to an empty list. */
export function resetContexts(): void {
  files = [];
  setContexts([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useContexts(): ClusterContext[] {
  return useSyncExternalStore(subscribe, getContexts, getContexts);
}

/** The context a workspace's cluster id stands for, if the kubeconfig still has it. */
export function contextFor(stableId: string | null | undefined): ClusterContext | undefined {
  if (!stableId) return undefined;
  return contexts.find((c) => c.stableId === stableId);
}

/**
 * The active cluster's context, re-rendering on a change to either the store or
 * the active cluster. A screen with no answer here renders its "no cluster"
 * state rather than calling core with an empty context name.
 */
export function useActiveContext(): ClusterContext | undefined {
  const active = useActiveCluster();
  const all = useContexts();
  return active ? all.find((c) => c.stableId === active) : undefined;
}
