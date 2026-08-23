import { useEffect, useState, type ReactNode } from "react";
import {
  ageFromTimestamp,
  asArray,
  asRecord,
  phaseKind,
  plural,
  podMetrics,
  podsForSelector,
  relatedPodSelector,
  str,
  type Condition,
  type K8sObject,
  type PodMetric,
  type PodSummary,
} from "@srelens/core";
import { Button, KV, LoadingState, PairList, Section, StatusPill, Table, type Column } from "@srelens/ui-kit";
import { ConditionsSection } from "./ConditionsSection";

/**
 * The four kinds classic's `ObjectDetail` special-cases with their own
 * "Properties" section (`PodDetailsBody`, `WorkloadDetailsBody` for
 * Deployment/StatefulSet/ReplicaSet) — each already covers the same
 * Namespace/Created/Labels/Annotations/Controlled-by facts this wrapper's
 * identity block and its Labels/Annotations blocks would add, which is why
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
 * expanded — classic's `Expandable`/`ChipMap`.
 *
 * Reached by `Secret` alone; every other kind shows its annotations outright
 * (see `AnnotationsSection` below for why the exception is exactly one kind
 * wide). Nothing here uses `title`, `aria-label`, or any `data-*` for a value;
 * the toggle's own accessible name is just its visible "Show"/"Hide" text,
 * counting entries, never naming one.
 *
 * Deliberately not `PairList`, even now that `PairList` writes no `title`:
 * this is the one place a value must be absent from the document rather than
 * merely unshown, and a component that renders its pairs unconditionally
 * cannot promise that.
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
 * A kind's identity — classic's `GenericDetail` "Metadata" section, minus the
 * two things the design's own frame settles differently.
 *
 * No heading. The design heads the first block of a detail with nothing: the
 * pane's header has already given the name, the kind and the namespace, and a
 * "Metadata" bar under it is a second name for the same thing.
 *
 * No `Name` row either, for the same reason — it repeated the header verbatim
 * on every kind, which is a carry-over from classic rather than a decision.
 * `Created` reads as an age alone (`84d ago`); the absolute stamp classic
 * appended is a second rendering of one fact in a 352px column.
 *
 * Labels and Annotations are no longer rows here at all — squeezed into the
 * value column of a fact list, a `key=value` pair had about a third of the
 * pane to be read in. They are blocks of their own below.
 *
 * Namespace and Controlled by are a `ResourceLink`/`LinkedResources` in
 * classic that navigate — Namespace to the Namespace object, Controlled by to
 * each owner's own kind/name; neither can navigate here (`PaneBody` has no
 * navigation contract — see the task report), so both render as plain text.
 *
 * An object with none of these facts renders no block at all: an empty section
 * still has its padding and still draws a rule against whatever follows it.
 */
function IdentitySection({ object }: { object: K8sObject }) {
  const meta = object.metadata ?? {};
  const owners = meta.ownerReferences ?? [];
  const created = str(meta.creationTimestamp);
  if (!meta.namespace && !created && owners.length === 0) return null;

  return (
    <Section>
      {meta.namespace && <KV k="Namespace" v={str(meta.namespace)} mono />}
      {created && <KV k="Created" v={`${ageFromTimestamp(created, Date.now())} ago`} />}
      {owners.length > 0 && (
        <KV k="Controlled by" v={<StringList items={owners.map((o) => `${o.kind}/${o.name}`)} />} />
      )}
    </Section>
  );
}

/**
 * The object's labels, as a block of full-width `key=value` lines.
 *
 * `breakValues` is not decoration. `PairList` truncates by default and no
 * longer writes the value into a `title` attribute — that attribute was how a
 * Secret's whole applied manifest reached the DOM — so wrapping is now the
 * only way a long label is readable at all. Omitted outright when the object
 * has none, rather than shown as classic's chip widget does ("None").
 */
function LabelsSection({ labels }: { labels: Record<string, string> }) {
  const pairs = Object.entries(labels);
  if (pairs.length === 0) return null;
  return (
    <Section title="Labels">
      <PairList pairs={pairs} breakValues />
    </Section>
  );
}

/**
 * The object's annotations — open, the way the design draws them, on every
 * kind but `Secret`.
 *
 * DO NOT "simplify" the exception away. A `kubectl apply`-managed Secret
 * carries its ENTIRE applied manifest, base64 `data` map included, inside the
 * `kubectl.kubernetes.io/last-applied-configuration` annotation, and
 * `k8s.getObject`'s Secret redaction blanks `data`/`stringData` only — it
 * never touches `metadata.annotations`. So for this one kind an annotation
 * value IS the secret, and the toggle is what keeps it out of the document
 * until a reader asks for it, exactly as `SecretBody` keeps each `data` value
 * out until it is revealed.
 *
 * The kit fixed the other half of this: `PairList` used to put every value in
 * a row `title`, so a value the reader saw three characters of was sitting
 * whole in the markup. That fix is why every other kind can now open — an
 * annotation on a ConfigMap or a Deployment holds that object's own spec,
 * which the pane shows anyway — but it does nothing for text that is visible
 * on purpose, which is what a Secret's annotation would be.
 */
function AnnotationsSection({ kind, annotations }: { kind: string; annotations: Record<string, string> }) {
  const pairs = Object.entries(annotations);
  if (pairs.length === 0) return null;
  return (
    <Section title="Annotations">
      {kind === "Secret" ? (
        <AnnotationsToggle annotations={annotations} />
      ) : (
        <PairList pairs={pairs} breakValues />
      )}
    </Section>
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

/**
 * The Details pane's fallback wrapper — classic's `GenericDetail`, on the
 * design's own shape: a flat run of blocks divided by hairline rules, not a
 * stack of cards. The identity facts come first and unheaded, then the kind's
 * own `DETAILS_BODY` entry nested inside (`children`, classic's `KindBody`)
 * where one exists, then related pods (where `relatedPodSelector` finds a
 * selector for this kind), then Conditions, Labels and Annotations — the
 * order the design's own frames read in.
 *
 * Every block is a sibling of every other, with nothing wrapped around any of
 * them: `.section + .section` is what draws the rule between two blocks, so a
 * div around one would quietly remove the rule on both sides of it. A block
 * with nothing to say renders nothing at all rather than an empty section, and
 * the rules then land in the right places on their own — nothing counts blocks
 * or is told which one is first.
 *
 * `ResourceDetail` wraps every kind's Details pane in this component; for the
 * four `SELF_DESCRIBING_KINDS` it passes through `children` untouched, since
 * those kinds' own bodies already show the facts this wrapper would otherwise
 * duplicate. Adding a kind to `DETAILS_BODY` nests it here automatically, and
 * a kind with no entry still gets a complete, correct detail from this wrapper
 * alone.
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

  const meta = object.metadata ?? {};
  const namespace = str(meta.namespace);
  const conditions = asArray(asRecord(object.status).conditions) as unknown as Condition[];
  const podSelector = relatedPodSelector(kind, object);
  const hasPodSelector = Object.keys(podSelector).length > 0;

  return (
    <>
      <IdentitySection object={object} />
      {children}
      {context && namespace && hasPodSelector && (
        <RelatedPodsSection context={context} namespace={namespace} selector={podSelector} />
      )}
      <ConditionsSection conditions={conditions} />
      <LabelsSection labels={meta.labels ?? {}} />
      <AnnotationsSection kind={kind} annotations={meta.annotations ?? {}} />
    </>
  );
}
