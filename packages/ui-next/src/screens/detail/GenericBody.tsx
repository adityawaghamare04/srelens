import { useEffect, useState, type ReactNode } from "react";
import {
  absoluteTimestamp,
  ageFromTimestamp,
  asArray,
  asRecord,
  conditionKind,
  phaseKind,
  plural,
  podMetrics,
  podsForSelector,
  relatedPodSelector,
  str,
  timestampWithAge,
  type Condition,
  type K8sObject,
  type PodMetric,
  type PodSummary,
} from "@srelens/core";
import { Button, KV, LoadingState, PairList, Panel, StatusPill, Table, type Column } from "@srelens/ui-kit";

/**
 * The four kinds classic's `ObjectDetail` special-cases with their own
 * "Properties" section (`PodDetailsBody`, `WorkloadDetailsBody` for
 * Deployment/StatefulSet/ReplicaSet) — each already covers the same
 * Name/Namespace/Created/Labels/Annotations/Controlled-by facts this
 * wrapper's Metadata section would otherwise add, which is exactly why
 * classic renders them without its generic wrapper (`GenericDetail`) at all.
 * Every other kind — including DaemonSet, which classic does NOT special-case
 * here even though it has its own body — falls through to `GenericBody`,
 * alone or with a `DETAILS_BODY` entry nested inside it.
 */
export const SELF_DESCRIBING_KINDS: ReadonlySet<string> = new Set([
  "Pod",
  "Deployment",
  "StatefulSet",
  "ReplicaSet",
]);

/** A formatted list, one item per line — matches `PodBody`'s/`WorkloadBody`'s
 *  own helper of the same shape, kept local since it's a small presentational
 *  detail, not a shared formatter. */
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
 * Annotations, collapsed behind an explicit toggle and mounting nothing until
 * expanded — classic's `Expandable`/`ChipMap`, whose own code comment names
 * the exact reason: a `kubectl apply`-managed object carries
 * `kubectl.kubernetes.io/last-applied-configuration`, an annotation whose
 * value is the ENTIRE applied manifest — for a Secret, that includes the
 * complete base64 `data` map. `k8s.getObject`'s Secret redaction only blanks
 * `data`/`stringData`; it never touches `metadata.annotations`, so this is
 * the only gate standing between that value and the document.
 *
 * Deliberately NOT `PairList`: `PairList` puts every value into a `title`
 * attribute (`packages/ui-kit/src/PairList.tsx`), which would defeat the
 * point even while collapsed — a `title` on a mounted element is still in the
 * DOM. Nothing here uses `title`, `aria-label`, or any `data-*` for a value;
 * the toggle's own accessible name is just its visible "Show"/"Hide" text,
 * counting entries, never naming one.
 */
function AnnotationsToggle({ annotations }: { annotations: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(annotations);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : `Show ${plural(entries.length, "annotation")}`}
      </Button>
      {open && (
        <ul className="flex flex-col gap-0.5">
          {entries.map(([k, v]) => (
            <li key={k} className="break-all font-mono text-[0.8125rem]">
              {k}={v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A kind's identity — classic's `GenericDetail` "Metadata" section, ported
 * fact-for-fact and in classic's own order: Name, Namespace, Created (age
 * plus absolute time), Controlled by, Labels, Annotations. Namespace and
 * Controlled by are a `ResourceLink`/`LinkedResources` in classic that
 * navigate — Namespace to the Namespace object, Controlled by to each
 * owner's own kind/name; neither can navigate here (`PaneBody` has no
 * navigation contract — see the task report), so both render as plain text
 * instead. Labels is omitted outright when empty, rather than shown as
 * classic's chip widget does ("None") — the same convention `PodBody`'s and
 * `WorkloadBody`'s own Properties sections use, kept here too rather than
 * reintroducing classic's "None" text for this body alone. Annotations gets
 * its own rule (`AnnotationsToggle`, above): unlike Labels, an annotation
 * value is not safe to mount unconditionally — see its doc comment.
 */
function MetadataSection({ object }: { object: K8sObject }) {
  const meta = object.metadata ?? {};
  const labels = meta.labels ?? {};
  const annotations = meta.annotations ?? {};
  const owners = meta.ownerReferences ?? [];
  const created = str(meta.creationTimestamp);

  return (
    <Panel title="Metadata">
      <KV k="Name" v={str(meta.name)} mono />
      {meta.namespace && <KV k="Namespace" v={str(meta.namespace)} mono />}
      {created && <KV k="Created" v={timestampWithAge(created, Date.now())} />}
      {owners.length > 0 && (
        <KV k="Controlled by" v={<StringList items={owners.map((o) => `${o.kind}/${o.name}`)} />} />
      )}
      {Object.keys(labels).length > 0 && <KV k="Labels" v={<PairList pairs={Object.entries(labels)} />} />}
      {Object.keys(annotations).length > 0 && (
        <KV k="Annotations" v={<AnnotationsToggle annotations={annotations} />} />
      )}
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
 * The pods a kind manages, matched by `relatedPodSelector(kind, obj)` —
 * classic's `ManagedPods`, fetched live via core's
 * `podsForSelector`/`podMetrics` (metrics best-effort, same as classic: a
 * missing metrics-server must not hide the pods). Name and Node are
 * `ResourceLink`s in classic that navigate to the Pod/Node object; here they
 * render as plain mono text — see the task report for the full inert-value
 * list. Kept as its own copy rather than importing `WorkloadBody`'s
 * (unexported, and outside this task's file scope) — matches the "small
 * local helper, not a shared component" idiom the two body files already
 * follow for `StringList`.
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

const CONDITION_COLUMNS: Column<Condition>[] = [
  { key: "type", header: "Type", render: (c) => <StatusPill status={c.type} kind={conditionKind(c)} /> },
  { key: "status", header: "Status", render: (c) => c.status },
  { key: "reason", header: "Reason", render: (c) => c.reason || "—" },
  {
    key: "age",
    header: "Last transition",
    // Negated timestamp so ascending = most recent first (smallest age),
    // matching classic's own `ConditionsTable`.
    getSortValue: (c) => -(Date.parse(c.lastTransitionTime ?? "") || 0),
    render: (c) =>
      c.lastTransitionTime ? (
        <span title={absoluteTimestamp(c.lastTransitionTime)}>{ageFromTimestamp(c.lastTransitionTime)}</span>
      ) : (
        "—"
      ),
  },
];

/**
 * Classic's `ConditionsTable` — renders nothing at all, not an empty table,
 * when the object reports no conditions, so an object with none reads as
 * "nothing to show here" rather than a broken widget.
 */
function ConditionsSection({ conditions }: { conditions: Condition[] }) {
  if (conditions.length === 0) return null;
  return (
    <Panel title="Conditions">
      <Table columns={CONDITION_COLUMNS} data={conditions} getRowKey={(c) => c.type} />
    </Panel>
  );
}

/**
 * The Details pane's fallback wrapper — classic's `GenericDetail`. Renders
 * Metadata, then the kind's own `DETAILS_BODY` entry nested inside (`children`,
 * classic's `KindBody`) where one exists, then related pods (where
 * `relatedPodSelector` finds a selector for this kind), then Conditions — in
 * that order, matching classic's own `GenericDetail`.
 *
 * `ResourceDetail` wraps every kind's Details pane in this component; for the
 * four `SELF_DESCRIBING_KINDS` it passes through `children` untouched, since
 * those kinds' own bodies already show the facts this wrapper's Metadata
 * section would otherwise duplicate. Tasks 12 and 13 need do nothing extra
 * for the wrapper: adding a kind to `DETAILS_BODY` nests it here automatically,
 * and a kind with no entry still gets a complete, correct detail from this
 * wrapper alone.
 */
export function GenericBody({
  kind,
  object,
  context,
  children,
}: {
  kind: string;
  object: K8sObject;
  context: string;
  children?: ReactNode;
}) {
  if (SELF_DESCRIBING_KINDS.has(kind)) return <>{children}</>;

  const namespace = str(object.metadata?.namespace);
  const conditions = asArray(asRecord(object.status).conditions) as unknown as Condition[];
  const podSelector = relatedPodSelector(kind, object);
  const hasPodSelector = Object.keys(podSelector).length > 0;

  return (
    <>
      <MetadataSection object={object} />
      {children}
      {context && namespace && hasPodSelector && (
        <RelatedPodsSection context={context} namespace={namespace} selector={podSelector} />
      )}
      <ConditionsSection conditions={conditions} />
    </>
  );
}
