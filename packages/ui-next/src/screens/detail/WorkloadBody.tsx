import { useEffect, useState } from "react";
import {
  ageSortValue,
  asArray,
  asRecord,
  conditionKind,
  listReplicaSets,
  podMetrics,
  podsForSelector,
  str,
  timestampWithAge,
  updateStrategyText,
  type Condition,
  type K8sObject,
  type PodMetric,
  type PodSummary,
  type ReplicaSetSummary,
} from "@srelens/core";
import { EmptyState, KV, LoadingState, PairList, Panel, StatusPill, Table, type Column } from "@srelens/ui-kit";
import { phaseKind } from "../../lib/kinds/columns";

/** A formatted list, one item per line — matches `PodBody`'s own helper of
 *  the same shape, kept local since it's a small presentational detail, not
 *  a shared formatter. */
function StringList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item, i) => (
        <li key={`${item}-${i}`} className="font-mono text-[0.8125rem]">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * A workload's conditions as a row of status pills — classic's
 * `ConditionBadges`, ported onto the kit's `StatusPill` (coloured via core's
 * `conditionKind`, the same formatter Task 10 used for a Pod's condition
 * timeline) rather than reintroducing classic's separate badge-variant
 * heuristic as a second, un-shared way to colour a condition.
 */
function ConditionPills({ conditions }: { conditions: Condition[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {conditions.map((c) => (
        <StatusPill key={c.type} status={c.type} kind={conditionKind(c)} />
      ))}
    </div>
  );
}

const DEPLOY_REVISION_COLUMNS: Column<ReplicaSetSummary>[] = [
  { key: "revision", header: "#", render: (r) => <span className="font-mono">{r.revision || "—"}</span> },
  { key: "name", header: "Name", render: (r) => <span className="font-mono">{r.name}</span> },
  { key: "pods", header: "Pods", render: (r) => `${r.ready}/${r.desired}` },
  { key: "age", header: "Age", getSortValue: ageSortValue, render: (r) => r.age },
];

/**
 * The ReplicaSets a Deployment has rolled out — classic's `DeployRevisions`,
 * fetched live via core's `listReplicaSets`. Deployment-only: classic never
 * calls this for StatefulSet/DaemonSet/ReplicaSet either, since only a
 * Deployment has revision history of its own. Name is a `ResourceLink` in
 * classic, and the whole row is `onRowClick`-navigable; both render as
 * plain mono text here — see the task report for the full inert-value
 * list. Classic's own component has no write action (no rollback button, no
 * menu) — only navigation — so nothing needed to be scoped out on that
 * account; it only ever SHOWS revisions.
 */
function DeployRevisionsSection({
  context,
  namespace,
  ownerName,
}: {
  context: string;
  namespace: string;
  ownerName: string;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; revisions?: ReplicaSetSummary[] }>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    listReplicaSets(context, namespace, ownerName).then((out) => {
      if (!active) return;
      if (out.error) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", revisions: out.replicasets ?? [] });
    });
    return () => {
      active = false;
    };
  }, [context, namespace, ownerName]);

  if (state.status === "error") return null; // a missing revisions list shouldn't break the panel
  if (state.status === "loading") {
    return (
      <Panel title="Deploy Revisions">
        <LoadingState label="Loading revisions" />
      </Panel>
    );
  }

  return (
    <Panel title="Deploy Revisions">
      <Table
        columns={DEPLOY_REVISION_COLUMNS}
        data={state.revisions ?? []}
        getRowKey={(r) => r.name}
        emptyText="No revisions"
      />
    </Panel>
  );
}

interface RelatedPod extends PodSummary {
  cpu?: number;
  memory?: number;
}

const RELATED_POD_COLUMNS: Column<RelatedPod>[] = [
  { key: "name", header: "Name", render: (p) => <span className="font-mono">{p.name}</span> },
  { key: "node", header: "Node", render: (p) => <span className="font-mono">{p.node || "—"}</span> },
  { key: "ready", header: "Ready", render: (p) => p.ready },
  { key: "cpu", header: "CPU", render: (p) => (p.cpu != null ? (p.cpu / 1000).toFixed(3) : "—") },
  { key: "memory", header: "Memory", render: (p) => (p.memory != null ? `${p.memory} Mi` : "—") },
  { key: "status", header: "Status", render: (p) => <StatusPill status={p.phase} kind={phaseKind(p.phase)} /> },
];

/**
 * The pods a workload manages, matched by its label selector — classic's
 * `ManagedPods`. Fetched live via core's `podsForSelector`/`podMetrics`
 * (metrics best-effort, same as classic: a missing metrics-server must not
 * hide the pods). Name and Node are `ResourceLink`s in classic that navigate
 * to the Pod/Node object; here they render as plain mono text — see the task
 * report for the full inert-value list.
 */
function RelatedPodsSection({
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
      <Panel title="Pods">
        <LoadingState label="Loading pods" />
      </Panel>
    );
  }

  return (
    <Panel title="Pods">
      <Table columns={RELATED_POD_COLUMNS} data={state.pods ?? []} getRowKey={(p) => p.name} emptyText="No pods" />
    </Panel>
  );
}

/**
 * A Deployment/StatefulSet/ReplicaSet's Properties section — classic's
 * `WorkloadDetailView`, ported fact-for-fact. Namespace and Managed By are
 * `ResourceLink`/`LinkedResources` in classic that navigate; they render
 * here as plain text (see the task report for the full inert-value list).
 *
 * Labels, Annotations, Selector, Managed By and Conditions are OMITTED when
 * empty rather than shown as classic's chip widgets do ("None") — the same
 * convention `PodBody`'s Properties section settled on for the same reason:
 * the kit has no expandable chip component, and `PairList` (used here for
 * Labels/Annotations/Selector) already renders nothing for an empty set.
 * Keeping one idiom across both bodies rather than reintroducing classic's
 * "None" text for this body alone.
 */
function WorkloadPropertiesSection({ kind, object }: { kind: string; object: K8sObject }) {
  const meta = object.metadata ?? {};
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const labels = meta.labels ?? {};
  const annotations = meta.annotations ?? {};
  const selector = asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
  const owners = meta.ownerReferences ?? [];
  const conditions = asArray(status.conditions) as unknown as Condition[];
  const created = str(meta.creationTimestamp);

  const num = (v: unknown) => (v != null ? Number(v) : 0);
  const desired = spec.replicas != null ? num(spec.replicas) : 0;
  const total = num(status.replicas);
  const updated = num(status.updatedReplicas);
  const available = num(status.availableReplicas);
  const unavailable = num(status.unavailableReplicas);
  const replicaText = `${desired} desired, ${updated} updated, ${total} total, ${available} available, ${unavailable} unavailable`;

  // srelens shows "Running" once the workload is fully available.
  const running = desired > 0 && available >= desired;
  const phase = running ? "Running" : "Pending";

  const strategyType =
    kind === "Deployment" ? str(asRecord(spec.strategy).type) : updateStrategyText(asRecord(spec.updateStrategy));

  const serviceName = kind === "StatefulSet" ? str(spec.serviceName) : "";
  const volumeClaimTemplateNames =
    kind === "StatefulSet"
      ? asArray(spec.volumeClaimTemplates)
          .map((t) => str(asRecord(asRecord(t).metadata).name))
          .filter(Boolean)
      : [];

  return (
    <Panel title="Properties">
      {created && <KV k="Created" v={timestampWithAge(created, Date.now())} />}
      <KV k="Name" v={str(meta.name)} mono />
      {meta.namespace && <KV k="Namespace" v={str(meta.namespace)} mono />}
      {Object.keys(labels).length > 0 && <KV k="Labels" v={<PairList pairs={Object.entries(labels)} />} />}
      {Object.keys(annotations).length > 0 && (
        <KV k="Annotations" v={<PairList pairs={Object.entries(annotations)} />} />
      )}
      <KV k="Replicas" v={replicaText} />
      {Object.keys(selector).length > 0 && <KV k="Selector" v={<PairList pairs={Object.entries(selector)} />} />}
      {owners.length > 0 && (
        <KV k="Managed By" v={<StringList items={owners.map((o) => `${o.kind}/${o.name}`)} />} />
      )}
      {strategyType && <KV k="Strategy Type" v={strategyType} />}
      {serviceName && <KV k="Service" v={serviceName} mono />}
      {volumeClaimTemplateNames.length > 0 && (
        <KV k="Volume claim templates" v={volumeClaimTemplateNames.join(", ")} />
      )}
      <KV k="Status" v={<StatusPill status={phase} kind={phaseKind(phase)} />} />
      {conditions.length > 0 && <KV k="Conditions" v={<ConditionPills conditions={conditions} />} />}
    </Panel>
  );
}

/**
 * A DaemonSet's Scheduling section — classic's `DaemonSetBody`. Unlike the
 * other three workload kinds, a DaemonSet has no "replicas": its own numbers
 * are per-node (desired/current/ready/up-to-date/available across matching
 * nodes), read straight off `status`.
 */
function DaemonSetSchedulingSection({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const selector = asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
  const strategyText = updateStrategyText(asRecord(spec.updateStrategy));

  return (
    <Panel title="Scheduling">
      {status.desiredNumberScheduled != null && <KV k="Desired" v={str(status.desiredNumberScheduled)} />}
      {status.currentNumberScheduled != null && <KV k="Current" v={str(status.currentNumberScheduled)} />}
      {status.numberReady != null && <KV k="Ready" v={str(status.numberReady)} />}
      {status.updatedNumberScheduled != null && <KV k="Up-to-date" v={str(status.updatedNumberScheduled)} />}
      {status.numberAvailable != null && <KV k="Available" v={str(status.numberAvailable)} />}
      {strategyText && <KV k="Update strategy" v={strategyText} />}
      {Object.keys(selector).length > 0 && <KV k="Selector" v={<PairList pairs={Object.entries(selector)} />} />}
    </Panel>
  );
}

/**
 * The Details pane for Deployment, StatefulSet, DaemonSet and ReplicaSet —
 * classic's `WorkloadDetailView` (Deployment/StatefulSet/ReplicaSet) and
 * `DaemonSetBody` (DaemonSet), which classic renders as genuinely different
 * shapes (replica counts vs. per-node counts), not variations on one KV
 * list. A Deployment then shows its rolled-out revisions (classic's
 * `DeployRevisions`), and every kind with a selector shows its related pods
 * (classic's `ManagedPods`) — in that order, matching classic's own
 * `WorkloadDetailView`, which renders `DeployRevisions` before
 * `ManagedPods`.
 */
export function WorkloadDetailsBody({ object, context }: { object: K8sObject; context: string }) {
  const kind = str(object.kind);
  const spec = asRecord(object.spec);
  const namespace = str(object.metadata?.namespace);
  const name = str(object.metadata?.name);
  const selector = asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
  const hasSelector = Object.keys(selector).length > 0;

  if (!kind) return <EmptyState title="No workload data" />;

  return (
    <>
      {kind === "DaemonSet" ? (
        <DaemonSetSchedulingSection object={object} />
      ) : (
        <WorkloadPropertiesSection kind={kind} object={object} />
      )}
      {kind === "Deployment" && namespace && name && (
        <DeployRevisionsSection context={context} namespace={namespace} ownerName={name} />
      )}
      {hasSelector && namespace && (
        <RelatedPodsSection context={context} namespace={namespace} selector={selector} />
      )}
    </>
  );
}
