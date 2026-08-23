/**
 * The blocks a detail body is built from that more than one body needs — the
 * conditions list, the annotation rule, the managed-pods table. Each of them
 * was written two or three times before it was written once, and every copy
 * had drifted from the others by the time they were compared. (#331)
 */
import { useEffect, useState } from "react";
import {
  conditionKindWithReason,
  podMetrics,
  podsForSelector,
  podStatus,
  type Condition,
  type PodMetric,
  type PodSummary,
} from "@srelens/core";
import {
  KV,
  LoadingState,
  PairList,
  Section,
  StatusPill,
  Table,
  type Column,
} from "@srelens/ui-kit";

export interface ConditionsSectionProps {
  /**
   * The conditions to print, in the order they should read. Ordering is the
   * caller's — a Pod's lifecycle runs PodScheduled to Ready
   * (`orderPodConditions`), a workload's does not — and nothing here reorders
   * them.
   */
  conditions: Condition[];
}

/**
 * An object's conditions: one row each, the condition's name beside its
 * status and reason.
 *
 * The one implementation, replacing three. Conditions used to render a
 * sortable four-column `Table` for a generic kind, a three-part flex row for a
 * Pod, and — for a Deployment, the kind the design's own frame illustrates —
 * a bare row of pills carrying neither the status value nor the reason, so the
 * one thing a reader opens the block for was the one thing missing. Three
 * renderings of the same data is three chances to disagree about it, and they
 * did. (#331)
 *
 * Conditions arrive as data, never as an object to read: the module has no
 * idea whether it is printing a Pod's, a Node's or a Deployment's, which is
 * what lets every body share it. `conditionKindWithReason` is core's severity
 * heuristic, so a condition is toned the same way wherever it appears in this
 * design. It is the `WithReason` variant on purpose: this design's mock draws
 * a `Progressing · True · ReplicaSetUpdated` amber and the completed
 * `NewReplicaSetAvailable` green, which is a reading of one controller's
 * vocabulary and so a decision this design makes on its own. Classic calls
 * plain `conditionKind` and tones without it; that split is what keeps a
 * change made for this mock out of a frozen app's screens.
 *
 * The name is `tinted`, which colours it for a bad state and leaves it plain
 * for a good one — red `Available` above a plain `ReplicaFailure`, both beside
 * their own toned dot. The asymmetry lives in `StatusPill`; this only says the
 * rule applies here.
 *
 * The status and reason read as one value, `False · MinimumReplicasUnavailable`,
 * with an em dash standing in when there is no reason — an empty half of a
 * two-part value reads as a rendering fault. The last-transition time the old
 * table carried is gone: the design has no column for it, and the block is
 * read for what the object is complaining about, not when it started.
 *
 * An object reporting no conditions renders nothing at all — not an empty
 * block, which would still draw its own rule against the block below it.
 */
export function ConditionsSection({ conditions }: ConditionsSectionProps) {
  if (conditions.length === 0) return null;
  return (
    <Section title="Conditions">
      {conditions.map((condition) => (
        <KV
          key={condition.type}
          k={<StatusPill status={condition.type} kind={conditionKindWithReason(condition)} tinted />}
          v={`${condition.status} · ${condition.reason || "—"}`}
        />
      ))}
    </Section>
  );
}

/**
 * The annotation `kubectl apply` writes: the whole manifest it last sent,
 * verbatim, as one line of JSON.
 */
const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";

export interface AnnotationSplit {
  /** The annotations to print, in the object's own order. */
  shown: Array<[key: string, value: string]>;
  /** The keys held back, for a caller that wants to say so its own way. */
  withheld: string[];
}

/**
 * Split an annotation map into the part worth printing and the part that is
 * not.
 *
 * One key is held back, and only for how it reads: `last-applied-configuration`
 * is an entire manifest on a single line — kilobytes of JSON — and the design
 * prints annotations full-width and unwrapped, so on a real Deployment that one
 * value buries every other annotation under a screen or more of text in a pane
 * that is 352px wide. The design's four short lines are not what a cluster
 * looks like. Nothing is lost by holding it back: it is a copy of the object's
 * own spec, and the pane's YAML tab shows that in full, indented and
 * searchable, which is the better place to read it anyway.
 *
 * WHAT THIS IS NOT: it is not redaction, and no gate above it may be dropped on
 * its account. It happens to remove the one annotation through which a Secret's
 * base64 `data` map reaches the page, but that is a side effect of a
 * legibility rule, not a promise — any other annotation, on any kind, is
 * printed exactly as it arrives. `Secret` keeps its own gate in `GenericBody`
 * (`AnnotationsToggle`, which mounts nothing until a reader asks), and a Secret
 * must never be routed through this instead. (#331)
 */
export function partitionAnnotations(annotations: Record<string, string>): AnnotationSplit {
  const entries = Object.entries(annotations);
  return {
    shown: entries.filter(([k]) => k !== LAST_APPLIED),
    withheld: entries.filter(([k]) => k === LAST_APPLIED).map(([k]) => k),
  };
}

/**
 * An object's annotations as full-width `key=value` lines, with the applied
 * manifest held back and a line saying where to read it instead.
 *
 * `breakValues` is not decoration: `PairList` truncates by default and no
 * longer writes the value into a row `title`, so wrapping is the only way a
 * long annotation can be read at all.
 *
 * Shared rather than written per body because every kind has this problem —
 * `Pod`, `Deployment`, `StatefulSet` and `ReplicaSet` print their annotations
 * with no gate at all — and a rule about what a pane withholds is worth
 * exactly one implementation. The heading belongs to the caller: this is the
 * inside of a `Section`, not the section.
 */
export function AnnotationLines({ annotations }: { annotations: Record<string, string> }) {
  const { shown, withheld } = partitionAnnotations(annotations);
  return (
    <>
      <PairList pairs={shown} breakValues />
      {withheld.length > 0 && (
        <p className="text-[0.75rem] text-muted">
          {withheld.join(", ")} {withheld.length === 1 ? "is" : "are"} not printed here — the whole manifest
          on one line. The YAML tab shows it in full.
        </p>
      )}
    </>
  );
}

interface RelatedPod extends PodSummary {
  cpu?: number;
  memory?: number;
}

/**
 * `Status` reads `podStatus`, NOT `phaseKind(p.phase)`. A pod whose container
 * sits in a back-off loop still reports phase "Running", so a column reading
 * the phase alone drew a crash-looping pod green in a table headed by a
 * Deployment the reader had opened BECAUSE it was degraded. `PodSummary`
 * already carries the waiting reason for exactly this; the list rows and the
 * detail header read the same function. (#331)
 */
const RELATED_POD_COLUMNS: Column<RelatedPod>[] = [
  { key: "name", header: "Name", render: (p) => <span className="font-mono">{p.name}</span> },
  { key: "node", header: "Node", render: (p) => <span className="font-mono">{p.node || "—"}</span> },
  { key: "ready", header: "Ready", render: (p) => p.ready },
  { key: "cpu", header: "CPU", render: (p) => (p.cpu != null ? (p.cpu / 1000).toFixed(3) : "—") },
  { key: "memory", header: "Memory", render: (p) => (p.memory != null ? `${p.memory} Mi` : "—") },
  {
    key: "status",
    header: "Status",
    render: (p) => {
      const status = podStatus(p.phase, p.waitingReason);
      return <StatusPill status={status.status} kind={status.health} tinted />;
    },
  },
];

/**
 * The pods a workload manages, matched by a label selector — classic's
 * `ManagedPods`. Fetched live via core's `podsForSelector`/`podMetrics`
 * (metrics best-effort, same as classic: a missing metrics-server must not
 * hide the pods). Name and Node are `ResourceLink`s in classic that navigate
 * to the Pod/Node object; here they render as plain mono text — see the task
 * report for the full inert-value list.
 *
 * One implementation, replacing two identical ones: `WorkloadBody` and
 * `GenericBody` each carried their own copy of this and of its column table,
 * and both drew a pod's status from its phase alone. A fix applied to one copy
 * and not the other is how two panels start disagreeing about one pod. (#331)
 *
 * Loading renders inside the `Section`, never beside it: a bare `LoadingState`
 * between two sections breaks the `.section + .section` chain and leaves both
 * gaps unruled.
 */
export function RelatedPodsSection({
  context,
  namespace,
  selector,
}: {
  context: string;
  namespace: string;
  selector: Record<string, string>;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; pods?: RelatedPod[] }>({
    status: "loading",
  });
  const selectorKey = JSON.stringify(selector);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    Promise.all([
      podsForSelector(context, namespace, selector),
      // Metrics are best-effort: a missing metrics-server must not hide pods.
      podMetrics(context, namespace).catch((): { metrics?: PodMetric[] } => ({ metrics: [] })),
    ]).then(([podsOut, metricsOut]) => {
      if (!active) return;
      if (podsOut.error) {
        setState({ status: "error" });
        return;
      }
      const usage = new Map((metricsOut.metrics ?? []).map((m) => [m.name, m]));
      const pods = (podsOut.pods ?? []).map((p) => {
        const m = usage.get(p.name);
        return { ...p, cpu: m?.cpuMillicores, memory: m?.memoryMiB };
      });
      setState({ status: "ready", pods });
    });
    return () => {
      active = false;
    };
    // selectorKey captures the selector's identity without a new object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, namespace, selectorKey]);

  if (state.status === "error") return null; // a missing pods list shouldn't break the panel
  if (state.status === "loading") {
    return (
      <Section title="Pods">
        <LoadingState label="Loading pods" />
      </Section>
    );
  }

  return (
    <Section title="Pods">
      <Table columns={RELATED_POD_COLUMNS} data={state.pods ?? []} getRowKey={(p) => p.name} emptyText="No pods" />
    </Section>
  );
}
