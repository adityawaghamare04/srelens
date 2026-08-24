import { invokeCapability, type Invoker } from "../transport/transport";

/**
 * Fleet's per-cluster pod tally: pods in the `Running` phase over every pod
 * regardless of phase. A liveness figure, not a health one — a `Running` pod
 * can still be crash-looping.
 */
export interface PodCount {
  running: number;
  total: number;
}

export interface PodCountOutcome {
  counts?: PodCount;
  error?: string;
}

/**
 * Load a cluster's running/total pod counts via the `k8s.podCount`
 * capability. The backend counts without listing pod bodies and carries its
 * own short timeout (3s — see `POD_COUNT_TIMEOUT` in `crates/kube/src/metrics.rs`),
 * so a slow or unreachable cluster surfaces as `error`, never as `counts`
 * with zeros: a cluster that didn't answer has not told us it has no pods.
 */
export async function podCount(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<PodCountOutcome> {
  try {
    const counts = await invoke<PodCount>("k8s.podCount", { context });
    return { counts };
  } catch (e) {
    return { error: String(e) };
  }
}
