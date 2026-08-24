import { useCallback, useMemo } from "react";
import {
  K8S_KIND,
  clusterCapacity,
  clusterFacts,
  listDaemonSets,
  listDeployments,
  listNamespaces,
  listNodes,
  listPods,
  listResource,
  listStatefulSets,
  nodeMetrics,
  nodeUsage,
  type ClusterCapacity,
  type ClusterFacts,
  type DaemonSetSummary,
  type DeploymentSummary,
  type NodeSummary,
  type NodeUsage,
  type PodSummary,
  type ResourceKind,
  type StatefulSetSummary,
} from "@srelens/core";
import { useResource, type ResourceStatus } from "./useResource";

/**
 * The cluster overview's data layer: one loader per independent fact.
 *
 * Classic's `ClusterOverview` fires six list calls through a single
 * `Promise.all` and rethrows the first error it finds, so one refused list —
 * `nodes` on a namespaced service account, say — blanks the whole dashboard,
 * including the five answers that came back fine. That is the property this
 * module exists not to have.
 *
 * A screen made of independent facts fails in independent pieces: a refused
 * `listNodes` empties the nodes table and says so, while the namespace count,
 * the object counts, the control-plane facts and Fleet stay on screen. Every
 * hook below therefore owns its own `useResource`, and nothing here ever
 * awaits two capabilities in a way that lets one fail the other.
 *
 * The second rule, running through all of it: **`null` is not zero.** A
 * percentage of `null` means "no reading" — metrics-server absent, or a node
 * that has not been scraped yet — and `0%` is a measurement that reads as an
 * idle cluster. The same holds one level up: a namespace count of `null` is a
 * refusal, not an empty cluster. Nothing between core's arithmetic and the
 * screen may coalesce one into the other.
 *
 * Percentages leave here exactly as `nodeUsage` computed them: unrounded and
 * uncapped. `Meter` clamps the bar it draws while keeping `aria-valuetext`
 * truthful; clamping in between would make a node at 140% indistinguishable
 * from one exactly at its limit, hiding the case a reader most needs to see.
 */

/** An outcome-shaped core call, turned into the rejection `useResource` reads. */
function unwrap<T>(value: T | undefined, error: string | undefined, what: string): T {
  if (error) throw new Error(error);
  if (value === undefined) throw new Error(`${what} returned no data`);
  return value;
}

/** One node, paired with its usage against its own allocatable capacity. */
export interface OverviewNode {
  node: NodeSummary;
  usage: NodeUsage;
}

export interface OverviewNodes {
  status: ResourceStatus;
  nodes: OverviewNode[];
  /** The cluster-wide sums for the capacity strip; carries its own `null`s. */
  capacity: ClusterCapacity;
  /** Why the node list is unavailable. The table is empty and says this. */
  error?: string;
  /**
   * Why there are no readings — held apart from `error` on purpose. A cluster
   * with no metrics-server still has a nodes table; it just has no meters, and
   * the rail states the absence once rather than every column announcing it.
   */
  metricsError?: string;
  reload(): void;
}

/**
 * The nodes table's rows and the capacity strip's totals.
 *
 * Two capabilities, two loaders: `listNodes` and `nodeMetrics` fail
 * independently, and neither empties the other. Metrics are the ones that go
 * missing in practice (metrics-server is not installed on every cluster), and
 * losing the node list to that would be the exact all-or-nothing failure this
 * module is written against.
 *
 * @param pods - Every pod in the cluster, or `undefined` while that list is
 *   unknown or was refused. Passed in rather than listed here so the screen
 *   makes one `listPods` call for the pod tile, the unhealthy list and these
 *   per-node counts, instead of three.
 */
export function useOverviewNodes(context: string, pods: PodSummary[] | undefined): OverviewNodes {
  const nodes = useResource(
    () => listNodes(context).then((o) => unwrap(o.nodes, o.error, "listNodes")),
    [context],
  );
  const metrics = useResource(
    () => nodeMetrics(context).then((o) => unwrap(o.metrics, o.error, "nodeMetrics")),
    [context],
  );

  const list = nodes.data;
  const readings = metrics.data;

  const podsByNode = useMemo(() => {
    if (!pods) return undefined;
    const counts = new Map<string, number>();
    for (const pod of pods) counts.set(pod.node, (counts.get(pod.node) ?? 0) + 1);
    return counts;
  }, [pods]);

  const rows = useMemo<OverviewNode[]>(() => {
    if (!list) return [];
    const byName = new Map((readings ?? []).map((m) => [m.name, m]));
    return list.map((node) => ({
      node,
      // The one place a `0` is legitimate: when `podsByNode` exists the pod
      // list is KNOWN, and a node missing from it genuinely has no pods on it.
      // When the map is `undefined` the count is unknown, and `undefined` is
      // what `nodeUsage` turns into a `pods` of `null` — never `{ used: 0 }`,
      // which would claim an empty node nobody counted.
      usage: nodeUsage(node, byName.get(node.name), podsByNode ? (podsByNode.get(node.name) ?? 0) : undefined),
    }));
  }, [list, readings, podsByNode]);

  // Sums only over nodes that reported; `clusterCapacity` carries
  // `nodesReporting`/`nodesTotal` so the screen cannot show a partial total as
  // if it were a whole one.
  const capacity = useMemo(() => clusterCapacity(list ?? [], readings ?? []), [list, readings]);

  const reloadNodes = nodes.reload;
  const reloadMetrics = metrics.reload;
  const reload = useCallback(() => {
    reloadNodes();
    reloadMetrics();
  }, [reloadNodes, reloadMetrics]);

  return {
    status: nodes.status,
    nodes: rows,
    capacity,
    error: nodes.error,
    metricsError: metrics.error,
    reload,
  };
}

export interface OverviewPods {
  status: ResourceStatus;
  /**
   * Every pod in the cluster, or `undefined` when that is not known — loading,
   * or refused. Deliberately not defaulted to `[]`: an empty array is the
   * answer "this cluster has no pods", which would zero the pod tile and every
   * node's pod column on a cluster that simply has not answered yet.
   */
  pods?: PodSummary[];
  error?: string;
  reload(): void;
}

/**
 * The cluster's pods, listed once and shared.
 *
 * Three sections need them — the Pods tile, the per-node `31/50` column and
 * the `NOT READY` list — and this is the call that serves all three. Counting
 * a pod list by `spec.nodeName` (`PodSummary.node`) is how pods-per-node is
 * derived; there is no cheaper source for it, and the list is being fetched
 * for the unhealthy section regardless, so it costs nothing extra here.
 *
 * Fleet is the case that cannot afford this, which is why it counts through
 * the `podCount` capability per cluster instead of listing ten pod lists.
 */
export function useOverviewPods(context: string): OverviewPods {
  const pods = useResource(
    () => listPods(context, "").then((o) => unwrap(o.pods, o.error, "listPods")),
    [context],
  );
  return { status: pods.status, pods: pods.data, error: pods.error, reload: pods.reload };
}

export interface NamespaceCount {
  status: ResourceStatus;
  /** `null` when unknown — loading, or refused. Never `0` for either. */
  count: number | null;
  error?: string;
  reload(): void;
}

/** The Namespaces tile's number, and nothing else — the tile has no caption. */
export function useNamespaceCount(context: string): NamespaceCount {
  const namespaces = useResource(
    () => listNamespaces(context).then((o) => unwrap(o.namespaces, o.error, "listNamespaces")),
    [context],
  );
  return {
    status: namespaces.status,
    count: namespaces.data === undefined ? null : namespaces.data.length,
    error: namespaces.error,
    reload: namespaces.reload,
  };
}

/**
 * The kinds the rail's `OBJECTS BY KIND` section counts, in the design's
 * order. Slugs, not Kubernetes kinds, so each row can open `/k/<slug>` and
 * take its label from `RESOURCE_LABELS` without a second table.
 */
export const OVERVIEW_KINDS: ResourceKind[] = [
  "deployments",
  "pods",
  "statefulsets",
  "daemonsets",
  "cronjobs",
  "jobs",
];

export interface KindCount {
  slug: ResourceKind;
  /** `null` when this kind could not be counted. Never `0` for a refusal. */
  count: number | null;
  /** Why this one kind has no count. The other rows are unaffected. */
  error?: string;
}

export interface ObjectCounts {
  status: ResourceStatus;
  counts: KindCount[];
  error?: string;
  reload(): void;
}

/**
 * One list call per kind, each carrying its own failure.
 *
 * The `Promise.all` here is safe in the way classic's was not: `listResource`
 * returns its error rather than throwing, so no branch of this fan-out can
 * reject and cancel the others. A kind the user cannot list becomes one row
 * with `count: null` and a reason; the other five keep their numbers.
 */
export function useObjectCounts(context: string): ObjectCounts {
  const counts = useResource(
    () =>
      Promise.all(
        OVERVIEW_KINDS.map((slug) =>
          listResource(context, K8S_KIND[slug], "").then<KindCount>((o) =>
            o.error ? { slug, count: null, error: o.error } : { slug, count: (o.items ?? []).length },
          ),
        ),
      ),
    [context],
  );
  return {
    status: counts.status,
    counts: counts.data ?? [],
    error: counts.error,
    reload: counts.reload,
  };
}

export interface OverviewWorkloads {
  status: ResourceStatus;
  /**
   * The kind's rows, or `undefined` when it could not be listed. Deliberately
   * not `[]`: an empty array is the answer "this cluster runs no Deployments",
   * and the `Not ready` list would then read a refusal as a clean bill of
   * health — the one thing that section must never do.
   */
  deployments?: DeploymentSummary[];
  statefulSets?: StatefulSetSummary[];
  daemonSets?: DaemonSetSummary[];
  /** One reason per kind that was refused. The kinds that answered still render. */
  errors: string[];
  error?: string;
  reload(): void;
}

/**
 * The three scaling kinds the `Not ready` list draws its workload rows from.
 *
 * Deployments, StatefulSets and DaemonSets — the kinds core's `scaledStatus`
 * gives a ready-out-of-desired verdict for. Jobs and CronJobs are deliberately
 * not here: a CronJob has no unhealthy state of its own (the health lives in
 * the Jobs it spawns), and a failed Job's pods are already in the pod list as
 * Pods, with the phase that says what went wrong.
 *
 * One `useResource` over three calls that cannot reject — every `list*`
 * wrapper returns its error rather than throwing — so the fan-out is safe in
 * the way classic's `Promise.all` was not: no branch can cancel the others.
 */
export function useOverviewWorkloads(context: string): OverviewWorkloads {
  const loaded = useResource(
    () =>
      Promise.all([
        // The empty namespace is every namespace: the overview is a whole
        // cluster's view, and so is the list beneath it.
        listDeployments(context, ""),
        listStatefulSets(context, ""),
        listDaemonSets(context, ""),
      ]).then(([deployments, statefulSets, daemonSets]) => ({
        deployments: deployments.deployments,
        statefulSets: statefulSets.statefulsets,
        daemonSets: daemonSets.daemonsets,
        errors: [deployments.error, statefulSets.error, daemonSets.error].filter(
          (reason): reason is string => reason !== undefined,
        ),
      })),
    [context],
  );

  return {
    status: loaded.status,
    deployments: loaded.data?.deployments,
    statefulSets: loaded.data?.statefulSets,
    daemonSets: loaded.data?.daemonSets,
    errors: loaded.data?.errors ?? [],
    error: loaded.error,
    reload: loaded.reload,
  };
}

export interface OverviewFacts {
  status: ResourceStatus;
  /**
   * The control-plane facts. `provider` and `region` are empty when the
   * cluster named none, and the rail omits those rows — "unknown" as a value
   * would look like an answer.
   */
  facts?: ClusterFacts;
  error?: string;
  reload(): void;
}

/**
 * The rail's Provider, Region and Metrics server rows.
 *
 * `clusterFacts` never rejects: it normalises a failure into empty facts plus
 * a reason. Empty facts are indistinguishable from a cluster that named none,
 * so a carried `error` is mapped back to an error status here rather than
 * being handed to the rail as six silently omitted rows.
 */
export function useClusterFacts(context: string): OverviewFacts {
  const facts = useResource(() => clusterFacts(context), [context]);
  const carried = facts.data?.error;
  return {
    status: carried ? "error" : facts.status,
    facts: facts.data,
    error: carried ?? facts.error,
    reload: facts.reload,
  };
}

export interface Overview {
  nodes: OverviewNodes;
  pods: OverviewPods;
  workloads: OverviewWorkloads;
  namespaces: NamespaceCount;
  objects: ObjectCounts;
  facts: OverviewFacts;
  /** Retry every section. Each still succeeds or fails on its own. */
  reload(): void;
}

/**
 * Every loader the screen composes, in one call.
 *
 * A single entry point so the sections cannot be wired up inconsistently, but
 * emphatically not a single request: each field below settles on its own
 * schedule and carries its own error, and there is no combined status because
 * there is no moment when "the overview" is loaded or failed as a whole.
 */
export function useOverview(context: string): Overview {
  const pods = useOverviewPods(context);
  const nodes = useOverviewNodes(context, pods.pods);
  const workloads = useOverviewWorkloads(context);
  const namespaces = useNamespaceCount(context);
  const objects = useObjectCounts(context);
  const facts = useClusterFacts(context);

  const reloadNodes = nodes.reload;
  const reloadPods = pods.reload;
  const reloadWorkloads = workloads.reload;
  const reloadNamespaces = namespaces.reload;
  const reloadObjects = objects.reload;
  const reloadFacts = facts.reload;
  const reload = useCallback(() => {
    reloadNodes();
    reloadPods();
    reloadWorkloads();
    reloadNamespaces();
    reloadObjects();
    reloadFacts();
  }, [reloadNodes, reloadPods, reloadWorkloads, reloadNamespaces, reloadObjects, reloadFacts]);

  return { nodes, pods, workloads, namespaces, objects, facts, reload };
}
