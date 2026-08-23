import { useEffect, useState } from "react";
import {
  ageFromTimestamp,
  ageSortValue,
  asArray,
  asRecord,
  listReplicaSets,
  str,
  updateStrategy,
  type Condition,
  type K8sObject,
  type ReplicaSetSummary,
} from "@srelens/core";
import { KV, LoadingState, PairList, Table, type Column } from "@srelens/ui-kit";
import { Section } from "./Section";
import {
  ConditionsSection,
  RelatedPodsSection,
  StringList,
} from "./sections";
import { SELF_DESCRIBING_KINDS } from "./GenericBody";

/** The annotation a Deployment records its current rollout number in. */
const REVISION_ANNOTATION = "deployment.kubernetes.io/revision";


/**
 * "RollingUpdate · surge 25% · unavailable 0" / "RollingUpdate · partition 2"
 * / "OnDelete".
 *
 * The form is this design's, read off frame A's Strategy row: a middle-dot
 * run rather than a parenthesised comma list, labels without their "max"
 * prefix, and surge named before unavailable. Where the mock and the build
 * disagree on a value's form, the mock wins.
 *
 * The FACTS come from core's `updateStrategy`, which every design shares; the
 * words are chosen here, and only here. Classic draws the same numbers as
 * "RollingUpdate (max unavailable 0, max surge 25%)" and is frozen, so a
 * shared formatter would have to pick one app's typography for both — it
 * briefly did, and retyped classic's rows by accident.
 *
 * One helper for every kind, so a DaemonSet's Update strategy row reads the
 * way a Deployment's does: the mock only draws the Deployment, but two forms
 * for one fact would be a worse answer than the one it does draw.
 */
function updateStrategyText(strategy: Record<string, unknown>): string {
  const { type, partition, maxSurge, maxUnavailable } = updateStrategy(strategy);
  const parts: string[] = [];
  if (partition != null) parts.push(`partition ${partition}`);
  if (maxSurge != null) parts.push(`surge ${maxSurge}`);
  if (maxUnavailable != null) parts.push(`unavailable ${maxUnavailable}`);
  return [type, ...parts].join(" · ");
}

/** The images a workload's pod template runs, each named once. */
function templateImages(spec: Record<string, unknown>): string[] {
  const containers = asArray(asRecord(asRecord(spec.template).spec).containers);
  return [...new Set(containers.map((c) => str(asRecord(c).image)).filter(Boolean))];
}

const DEPLOY_REVISION_COLUMNS: Column<ReplicaSetSummary>[] = [
  { key: "revision", header: "#", render: (r) => <span className="font-mono">{r.revision || "—"}</span> },
  { key: "name", header: "Name", render: (r) => <span className="font-mono">{r.name}</span> },
  { key: "pods", header: "Pods", render: (r) => `${r.ready}/${r.desired}` },
  { key: "age", header: "Age", getSortValue: ageSortValue, render: (r) => r.age },
];

interface RevisionsState {
  status: "idle" | "loading" | "ready" | "error";
  revisions?: ReplicaSetSummary[];
}

/**
 * The ReplicaSets a Deployment has rolled out, fetched once for the whole
 * body — classic's `DeployRevisions`, via core's `listReplicaSets`.
 *
 * Held here rather than inside the revisions table because two blocks need
 * it: the table below, and the `Revision` fact above it, whose "(6m ago)"
 * is the age of the ReplicaSet carrying the current revision number. Two
 * fetches of one list is one list too many, and two lists that arrive at
 * different moments is a pane that can show a revision the table does not
 * have.
 *
 * Deployment-only (`enabled`): classic never calls this for
 * StatefulSet/DaemonSet/ReplicaSet either, since only a Deployment has
 * revision history of its own. The hook still runs for every kind — hooks
 * must — and simply fetches nothing.
 */
function useDeployRevisions(context: string, namespace: string, ownerName: string, enabled: boolean): RevisionsState {
  const [state, setState] = useState<RevisionsState>({ status: "idle" });

  useEffect(() => {
    if (!enabled || !context || !namespace || !ownerName) {
      setState({ status: "idle" });
      return;
    }
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
  }, [context, namespace, ownerName, enabled]);

  return state;
}

/**
 * The revisions table itself — the fetched list, rendered. Name is a
 * `ResourceLink` in classic, and the whole row is `onRowClick`-navigable;
 * both render as plain mono text here — see the task report for the full
 * inert-value list. Classic's own component has no write action (no rollback
 * button, no menu) — only navigation — so nothing needed to be scoped out on
 * that account; it only ever SHOWS revisions.
 */
function DeployRevisionsSection({ state }: { state: RevisionsState }) {
  if (state.status === "idle" || state.status === "error") return null; // a missing list shouldn't break the pane
  return (
    <Section title="Deploy Revisions">
      {state.status === "loading" ? (
        <LoadingState label="Loading revisions" />
      ) : (
        <Table
          columns={DEPLOY_REVISION_COLUMNS}
          data={state.revisions ?? []}
          getRowKey={(r) => r.name}
          emptyText="No revisions"
        />
      )}
    </Section>
  );
}

/**
 * A Deployment/StatefulSet/ReplicaSet's facts, in the order the design's own
 * Deployment frame reads them: Replicas, Up to date, Strategy, Revision,
 * Selector, Min ready seconds, Namespace, Created, Image — with the
 * kind-specific extras (Managed by, a StatefulSet's Service and volume claim
 * templates) beside their own kin.
 *
 * No heading and no `Name` row: the pane's header has already given the name,
 * the kind and the namespace.
 *
 * NO STATUS ROW EITHER, and that is the fix rather than an omission. This
 * panel used to state a workload's health a second time, from
 * `availableReplicas >= desired` — and available is the subset of ready
 * replicas that have outlived `minReadySeconds`, so a Deployment with that
 * field set showed a header reading "Running · 12/12 ready" directly above a
 * panel reading "Pending". Two readings of one fact can disagree. The header
 * already says the word (through core's `resourceStatusLine`), the design's
 * own Deployment frame has no such row, and the numbers under it say the rest
 * — so the second reading is deleted, not re-pointed. The design DOES keep a
 * `Status` row on a Pod, where the phase is the pod's own vocabulary rather
 * than a count; `PodBody` renders it, from `resourceStatusLine`.
 *
 * `Replicas` reads "9 ready · 12 desired" — the design's form, and the same
 * two numbers the header and the list row show, off `status.readyReplicas`
 * like both of them. It replaces a five-number sentence ("12 desired, 9
 * updated, 12 total, 9 available, 0 unavailable") that made the reader find
 * the two that mattered; `Up to date` gets the row of its own the design
 * gives it, and the rest are on the YAML tab.
 *
 * `Strategy` is `updateStrategyText` below — core's `updateStrategy` facts in
 * this design's own words — for every kind. It always read the whole strategy
 * for a StatefulSet/DaemonSet; a Deployment alone read `spec.strategy.type`
 * and so printed "RollingUpdate" with the surge and unavailable clauses — the
 * two numbers that decide how a rollout behaves — dropped.
 *
 * Namespace and Managed by are a `ResourceLink`/`LinkedResources` in classic
 * that navigate; they render here as plain text (see the task report).
 */
function WorkloadFactsSection({
  kind,
  object,
  revisions,
}: {
  kind: string;
  object: K8sObject;
  revisions?: ReplicaSetSummary[];
}) {
  const meta = object.metadata ?? {};
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const selector = asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
  const owners = meta.ownerReferences ?? [];
  const created = str(meta.creationTimestamp);

  const num = (v: unknown) => (v != null ? Number(v) : 0);
  const desired = num(spec.replicas);
  const ready = num(status.readyReplicas);
  const updated = num(status.updatedReplicas);
  const strategy =
    kind === "Deployment"
      ? updateStrategyText(asRecord(spec.strategy))
      : updateStrategyText(asRecord(spec.updateStrategy));

  // The number is the Deployment's own annotation; the age belongs to the
  // ReplicaSet carrying that revision, which may not have arrived yet — the
  // number alone is still a true fact, so it shows without waiting.
  const revision = str((meta.annotations ?? {})[REVISION_ANNOTATION]);
  const revisionAge = revisions?.find((r) => r.revision === revision)?.age;
  const revisionText = revisionAge ? `${revision} (${revisionAge} ago)` : revision;

  const serviceName = kind === "StatefulSet" ? str(spec.serviceName) : "";
  const volumeClaimTemplateNames =
    kind === "StatefulSet"
      ? asArray(spec.volumeClaimTemplates)
          .map((t) => str(asRecord(asRecord(t).metadata).name))
          .filter(Boolean)
      : [];
  const images = templateImages(spec);

  return (
    <Section>
      <KV k="Replicas" v={`${ready} ready · ${desired} desired`} />
      <KV k="Up to date" v={`${updated} of ${desired}`} />
      {strategy && <KV k="Strategy" v={strategy} />}
      {revision && <KV k="Revision" v={revisionText} />}
      {Object.keys(selector).length > 0 && (
        <KV k="Selector" v={<PairList pairs={Object.entries(selector)} breakValues />} />
      )}
      {spec.minReadySeconds != null && <KV k="Min ready seconds" v={str(spec.minReadySeconds)} />}
      {owners.length > 0 && (
        <KV k="Managed by" v={<StringList items={owners.map((o) => `${o.kind}/${o.name}`)} />} />
      )}
      {serviceName && <KV k="Service" v={serviceName} mono />}
      {volumeClaimTemplateNames.length > 0 && (
        <KV k="Volume claim templates" v={volumeClaimTemplateNames.join(", ")} />
      )}
      {meta.namespace && <KV k="Namespace" v={str(meta.namespace)} mono />}
      {created && <KV k="Created" v={`${ageFromTimestamp(created, Date.now())} ago`} />}
      {images.length > 0 && (
        <KV
          k="Image"
          v={images.length === 1 ? <span className="font-mono">{images[0]}</span> : <StringList items={images} />}
        />
      )}
    </Section>
  );
}

/**
 * A DaemonSet's Scheduling block — classic's `DaemonSetBody`. Unlike the
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
    <Section title="Scheduling">
      {status.desiredNumberScheduled != null && <KV k="Desired" v={str(status.desiredNumberScheduled)} />}
      {status.currentNumberScheduled != null && <KV k="Current" v={str(status.currentNumberScheduled)} />}
      {status.numberReady != null && <KV k="Ready" v={str(status.numberReady)} />}
      {status.updatedNumberScheduled != null && <KV k="Up-to-date" v={str(status.updatedNumberScheduled)} />}
      {status.numberAvailable != null && <KV k="Available" v={str(status.numberAvailable)} />}
      {strategyText && <KV k="Update strategy" v={strategyText} />}
      {Object.keys(selector).length > 0 && (
        <KV k="Selector" v={<PairList pairs={Object.entries(selector)} breakValues />} />
      )}
    </Section>
  );
}



/**
 * The Details pane for Deployment, StatefulSet, DaemonSet and ReplicaSet —
 * classic's `WorkloadDetailView` (Deployment/StatefulSet/ReplicaSet) and
 * `DaemonSetBody` (DaemonSet), which classic renders as genuinely different
 * shapes (replica counts vs. per-node counts), not variations on one KV list —
 * on the design's own shape: a flat run of blocks divided by hairline rules,
 * not a stack of cards.
 *
 * Every block is a sibling of every other, with nothing wrapped around any of
 * them: `.section + .section` is what draws the rule between two blocks, so a
 * div — or a bare `LoadingState` — between two of them quietly removes the
 * rule on both sides. A block with nothing to say renders nothing at all.
 *
 * Conditions are rendered here ONLY for the `SELF_DESCRIBING_KINDS` — the same
 * gate related pods use, and for the same reason: a DaemonSet is wrapped by
 * `GenericBody`, which supplies them, so rendering them here too would show
 * them twice. Labels and Annotations are no longer rendered by any body at
 * all; the host places them once, which is what retired their half of this
 * guard.
 *
 * `kind` is the route's, handed down by `ResourceDetail` — not `object.kind`,
 * which this read until the whole-branch review. The API server happens to
 * return `kind` on a single-object GET, so the two agreed; but the pane is
 * dispatched on the route's kind and a body that re-derives it is a second
 * source of truth for the fact its own dispatch turned on. Taking the prop
 * also retires an `if (!kind)` guard that returned a bare `EmptyState` into
 * the run of sections, breaking the `.section + .section` hairline chain:
 * `DETAILS_BODY[""]` is undefined, so no empty kind can reach this at all.
 * (#331)
 *
 * Related pods (classic's `ManagedPods`) follow the same rule. DaemonSet is
 * deliberately excluded: classic's `DaemonSetBody` renders ONLY its Scheduling
 * section — it is the generic `GenericDetail` wrapper that supplies a
 * DaemonSet's related pods, and `GenericBody` (this package's port of that
 * wrapper) already adds one via `relatedPodSelector` for every kind that isn't
 * self-describing.
 */
export function WorkloadDetailsBody({
  kind,
  object,
  context,
}: {
  kind: string;
  object: K8sObject;
  context: string;
}) {
  const meta = object.metadata ?? {};
  const spec = asRecord(object.spec);
  const namespace = str(meta.namespace);
  const name = str(meta.name);
  const selector = asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
  const hasSelector = Object.keys(selector).length > 0;
  const selfDescribing = SELF_DESCRIBING_KINDS.has(kind);
  const conditions = asArray(asRecord(object.status).conditions) as unknown as Condition[];
  const revisions = useDeployRevisions(context, namespace, name, kind === "Deployment");

  return (
    <>
      {kind === "DaemonSet" ? (
        <DaemonSetSchedulingSection object={object} />
      ) : (
        <WorkloadFactsSection kind={kind} object={object} revisions={revisions.revisions} />
      )}
      <DeployRevisionsSection state={revisions} />
      {hasSelector && namespace && selfDescribing && (
        <RelatedPodsSection context={context} namespace={namespace} selector={selector} />
      )}
      {selfDescribing && <ConditionsSection conditions={conditions} />}
    </>
  );
}
