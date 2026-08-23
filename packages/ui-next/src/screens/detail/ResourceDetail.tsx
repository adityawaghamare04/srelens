import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  K8S_KIND,
  ageFromTimestamp,
  getManifest,
  listCrds,
  listEvents,
  redactSecretManifest,
  resourceStatusLine,
  type DynamicGvk,
  type EventSummary,
  type K8sObject,
} from "@srelens/core";
import {
  Alert,
  Badge,
  Button,
  CodeEditor,
  ErrorState,
  Inspector,
  LoadingState,
  Table,
  type Column,
  type InspectorProps,
  type TabItem,
} from "@srelens/ui-kit";
import { Icons } from "../../lib/icons";
import { descriptorFor } from "../../lib/kinds/descriptors";
import { useObject } from "../../lib/useObject";
import { ConfigDetailsBody } from "./ConfigBody";
import { CronJobDetailsBody } from "./CronJobBody";
import { GenericBody } from "./GenericBody";
import { JobDetailsBody } from "./JobBody";
import { NodeDetailsBody } from "./NodeBody";
import { PodContainersBody, PodDetailsBody } from "./PodBody";
import { SecretDetailsBody } from "./SecretBody";
import { ServiceDetailsBody } from "./ServiceBody";
import { WorkloadDetailsBody } from "./WorkloadBody";

/**
 * The peek host's own controls, both of them, in one object.
 *
 * The design gives the header two affordances the full tab has no use for:
 * dismiss the peek, and promote what is in it to a tab. They are not two
 * facts — they are one fact ("this pane is the peek") wearing two buttons —
 * so they arrive together rather than as two optional callbacks. A host
 * cannot pass one without the other, and `Resources.test`'s prop-by-prop
 * comparison of the two hosts still has exactly one prop to except.
 */
export interface ResourceDetailPeek {
  /** Dismiss the peek. Also what its Escape key reaches. */
  onClose: () => void;
  /**
   * Promote this subject to a tab of its own. The host's, not this pane's:
   * the list already mints that route for a row's double click, and one
   * expression producing both is what stops the button and the gesture
   * drifting onto two tabs for one resource.
   */
  onOpenTab: () => void;
}

export interface ResourceDetailProps {
  context: string;
  /** The Kubernetes kind ("Pod", "Deployment", ...) — the same value
   *  `detailRoute` and `useObject` take, not the list screen's slug. */
  kind: string;
  namespace: string | null;
  name: string;
  /**
   * Present only in the peek host — the tab host closes through the strip and
   * is already the tab, so it leaves this off. Still the ONE prop that tells
   * the two hosts apart: the peek and the tab are the same pane in two hosts
   * (R-5), and everything that varies between them is inside this object.
   * That is why the design's "Open tab" button did not arrive as a second
   * top-level callback — see {@link ResourceDetailPeek}.
   */
  peek?: ResourceDetailPeek;
}

/**
 * k8sKind → the list screen's slug, so this shell can ask the very
 * `KindDescriptor` the list already resolves what extra panes a kind offers.
 * Built from core's own table rather than hand-duplicated, so a kind added
 * there is never silently unresolvable here.
 */
const SLUG_BY_K8S_KIND: Record<string, string> = Object.fromEntries(
  Object.entries(K8S_KIND)
    .filter(([, k8sKind]) => k8sKind !== "")
    .map(([slug, k8sKind]) => [k8sKind, slug]),
);

function describeTarget(kind: string, namespace: string | null, name: string): string {
  return `${kind} ${namespace ? `${namespace}/` : ""}${name}`;
}

/**
 * Resolves a custom resource's `{group, version, plural}` from the cluster's
 * own CRD list, for `getManifest`'s optional fifth argument.
 *
 * `getManifest(context, kind, namespace, name, invoke, crd?)` needs that GVK
 * to resolve a CRD-backed kind — kind alone is ambiguous to the backend's
 * kind→GVR match, which has no CRD path at all (the same reason
 * `KindActions.delete` is withheld for custom resources in `lib/kinds/
 * custom.ts`). This shell only ever receives a bare `kind` string (not a
 * slug, not a `CrdRef`), and there is nowhere upstream to source one from
 * yet — no descriptor represents a CRD kind today, and threading a `CrdRef`
 * through `KindDescriptor`/props would only work once every future caller
 * remembers to supply it, which is exactly the kind of coordination gap that
 * has already bitten this component once (see Task 9's own "must remember to
 * set panes.containers" concern). Resolving it here instead means the YAML
 * pane works correctly for a custom resource the moment ANY caller passes
 * its kind — self-contained, not dependent on another task's discipline —
 * at the cost of one extra `listCrds` round trip per custom-resource YAML
 * open (skipped entirely for a built-in kind, and only paid once the reader
 * actually opens the YAML tab, matching this file's existing laziness).
 *
 * A `kind` with no CRD on the cluster (the CRD was deleted, or the caller
 * mis-typed it) is reported as an error, not silently passed through
 * unresolved: an unresolved `crd` would make `getManifest` guess via the
 * same ambiguous kind→GVR match this function exists to avoid, which can
 * fail confusingly or, worse, resolve to the wrong resource entirely.
 *
 * A `kind` claimed by MORE than one CRD is reported the same way, for the
 * same reason. Two groups can legitimately define the same `.kind`
 * (`widgets.example.com` and `widgets.other.io`), and this shell is handed a
 * bare kind string with no group to disambiguate it. Taking the first match
 * would fetch a manifest from possibly the wrong group and render it as
 * though it were the right one — a possibly-wrong success, which is worse
 * than a failure, because nothing on screen would say anything was ambiguous.
 */
async function resolveCrdGvk(
  context: string,
  kind: string,
): Promise<{ crd?: DynamicGvk; error?: string }> {
  const result = await listCrds(context);
  if (result.error) {
    return { error: `Could not look up ${kind}'s CustomResourceDefinition: ${result.error}` };
  }
  const matches = result.crds?.filter((c) => c.kind === kind) ?? [];
  if (matches.length === 0) {
    return {
      error: `${kind} has no matching CustomResourceDefinition on this cluster, so its manifest cannot be resolved.`,
    };
  }
  if (matches.length > 1) {
    // Sorted and de-duplicated so the message reads the same whichever order
    // `listCrds` happened to return them in.
    const groups = [...new Set(matches.map((c) => c.group))].sort().join(", ");
    return {
      error: `${kind} is claimed by more than one CustomResourceDefinition on this cluster (${groups}), so its manifest cannot be resolved unambiguously.`,
    };
  }
  const match = matches[0];
  return { crd: { group: match.group, version: match.version, plural: match.plural } };
}

type PaneBody = (props: { object: K8sObject; context: string }) => ReactNode;

/**
 * The Details pane's per-kind content. Tasks 10-13 each append one entry
 * here, keyed on `k8sKind`, as they port a family of classic's
 * `ResourceOverview` bodies. A kind absent from the table renders no nested
 * body of its own — `GenericBody` (below) still gives it a complete,
 * correct Details pane (classic's `GenericDetail`), and a kind in
 * `SELF_DESCRIBING_KINDS` renders its own entry with no wrapper at all —
 * a table for later tasks to extend, not a switch for this component to
 * grow.
 */
const DETAILS_BODY: Record<string, PaneBody> = {
  Pod: PodDetailsBody,
  Deployment: WorkloadDetailsBody,
  StatefulSet: WorkloadDetailsBody,
  DaemonSet: WorkloadDetailsBody,
  ReplicaSet: WorkloadDetailsBody,
  Service: ServiceDetailsBody,
  Node: NodeDetailsBody,
  Job: JobDetailsBody,
  CronJob: CronJobDetailsBody,
  ConfigMap: ConfigDetailsBody,
  Secret: SecretDetailsBody,
};

/** Same seam, for the Containers pane a kind's descriptor opts into via
 *  `panes.containers` (Task 10 sets it for Pod). */
const CONTAINERS_BODY: Record<string, PaneBody> = {
  Pod: PodContainersBody,
};

/** Same seam, for the Metrics pane a kind's descriptor opts into via
 *  `panes.metrics`. */
const METRICS_BODY: Record<string, PaneBody> = {};

type LoadStatus = "loading" | "ready" | "error";

interface LoadState<T> {
  status: LoadStatus;
  data?: T;
  error?: string;
}

/**
 * A pane's own data, loaded only once that pane has actually been opened for
 * the CURRENT `target` — `enabled` is the caller's "the reader has looked at
 * this, for this subject" signal, not "the object is ready". A peek fills on
 * nearly every row click; fetching the manifest and the events eagerly on
 * every one of those, when a reader usually looks at neither, is two wasted
 * calls per row. The caller keeps `enabled` true across a pane switch so
 * switching back to an already-opened pane never refetches, the same
 * generation-counter guard `useObject` uses against a stale result landing
 * after the target changed — but `enabled` can also go back to false on a
 * new target (a pane the reader isn't currently on), in which case the
 * settled data for the old target is dropped rather than left rendering
 * under the new one.
 *
 * The returned value is GATED on the target the held data was fetched for
 * matching the `target` passed in THIS render — not merely reset by the
 * effect below, which only runs after commit and paint. `ResourceDetail`'s
 * own subject-change reset (`openedPanes`) is safe because it happens
 * synchronously during render; this hook's settled data lives in its own
 * `useState`, and when the pane stays mounted across a subject change
 * (exactly what persisting `activeTab` buys), a real browser paints one
 * committed frame pairing the NEW subject's heading with the OLD subject's
 * data before that effect ever gets to run. The gate makes that
 * structurally unrenderable rather than merely fast: it is a plain
 * comparison computed fresh every render, so it holds even on the very
 * first commit after `target` changes, with no dependency on effect
 * ordering that a future refactor could quietly undo.
 */
function useLoad<T>(
  enabled: boolean,
  target: readonly [string, string, string | null, string],
  load: () => Promise<{ data?: T; error?: string }>,
): LoadState<T> {
  const targetKey = target.join(" ");
  const [state, setState] = useState<LoadState<T> & { targetKey: string }>({
    status: "loading",
    targetKey,
  });
  const gen = useRef(0);

  useEffect(() => {
    // Reset on every identity change, not only an enabling one: `target`
    // can change while `enabled` stays whatever it already was (or flips
    // to false, on a subject change for a pane that isn't the one on
    // screen), and either way the settled data for the OLD identity must
    // not go on being held once something newer is being asked for.
    const mine = ++gen.current;
    setState({ status: "loading", targetKey });
    if (!enabled) return;
    load().then(
      (result) => {
        if (gen.current !== mine) return;
        if (result.error) {
          setState({ status: "error", error: result.error, targetKey });
          return;
        }
        setState({ status: "ready", data: result.data, targetKey });
      },
      (e: unknown) => {
        if (gen.current !== mine) return;
        setState({ status: "error", error: e instanceof Error ? e.message : String(e), targetKey });
      },
    );
    return () => {
      if (gen.current === mine) gen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...target]);

  // The gate itself: if the data currently held was fetched for a different
  // target than the one being rendered right now, it is not this render's
  // to show — substitute "loading" rather than let it leak through for even
  // one committed frame.
  return state.targetKey === targetKey ? state : { status: "loading" };
}

/**
 * The design's third header line, for a kind that has one.
 *
 * `resourceStatusLine` decides the word, its tone and the unhealthy dot
 * together, off the fetched object; the age is not in its answer because it
 * is not a health fact, so it comes off the metadata here. `null` back from it
 * is an ANSWER, not a gap — a ConfigMap has no health and a custom resource's
 * `status` is its own operator's business — and it takes the whole line with
 * it, age included: a lone age with nothing to qualify it reads as the rest
 * having gone missing.
 *
 * Two things about the facts that are silent when wrong, both of them
 * `InspectorFact`'s doing:
 *
 * - `label` is never drawn — it is an `sr-only` `dt`. So the VALUE carries its
 *   own noun ("9/12 ready", not "9/12"), which is the user's ruling over the
 *   kit's objection, and the label is the term a screen reader hears. It has
 *   to say something the value does not. "Progress" rather than "Ready"
 *   because the phrase is not always about readiness: a Job's reads
 *   "3/3 complete".
 * - a fact defaults to normal ink. Only the age is quiet in the mock, so only
 *   the age asks for a tone.
 */
function statusHeader(
  kind: string,
  object: K8sObject,
): Pick<InspectorProps, "status" | "statusKind" | "facts" | "flagged"> {
  const line = resourceStatusLine(kind, object);
  if (!line) return {};
  const facts: InspectorProps["facts"] = [];
  if (line.readyText) facts.push({ label: "Progress", value: line.readyText });
  const created = object.metadata?.creationTimestamp;
  // Only when there is one: `ageFromTimestamp` answers "—" for an absent
  // stamp, and an em dash in the header is noise, not information.
  if (created) facts.push({ label: "Age", value: ageFromTimestamp(created), tone: "muted" });
  // `HealthKind` and `StatusKind` are the same five words by construction —
  // core says so in `k8sHealth`'s own comment — so the verdict passes straight
  // through rather than being re-mapped into a second opinion.
  return { status: line.status, statusKind: line.health, facts, flagged: line.flagged };
}

/**
 * The design's other header affordance: promote this subject to a tab of its
 * own. Outlined and labelled, beside the close rather than instead of it —
 * the mock draws two separate controls, and a peek that could only be left by
 * closing it is a peek the reader has to re-find.
 */
function OpenTabButton({ onClick }: { onClick: () => void }) {
  const Glyph = Icons.openTab;
  return (
    <Button type="button" variant="outline" size="xs" onClick={onClick}>
      {/* The word is the accessible name; the glyph only decorates it. */}
      <Glyph size={12} aria-hidden="true" />
      Open tab
    </Button>
  );
}

const PANE_DETAILS = "details";
const PANE_CONTAINERS = "containers";
const PANE_METRICS = "metrics";
const PANE_YAML = "yaml";
const PANE_EVENTS = "events";

/**
 * The detail shell: one subject, identified at the top, its panes beneath.
 *
 * Mounted in two hosts per the spec's R-5 ruling — a peek pane inside the
 * list, and a full tab of its own — rendering the very same component with
 * the very same props, so a pane opened one way and reached the other way is
 * never a different pane. The peek passes `peek`; the tab does not; that is
 * the ONLY thing either host varies, and the design's two peek-only header
 * controls both live inside that one object rather than beside it (see
 * {@link ResourceDetailPeek}). Everything on screen comes from `useObject`,
 * the single read both hosts share, which is what makes it impossible for the
 * peek and the tab to disagree about what they show.
 *
 * Which extra panes a kind offers (Containers, Metrics) comes off its
 * `KindDescriptor` — never a branch on `kind` in this component. The
 * Details/Containers/Metrics pane bodies are per-kind content that Tasks
 * 10-13 port in; see the `*_BODY` tables above for the seam they fill.
 */
export function ResourceDetail({ context, kind, namespace, name, peek }: ResourceDetailProps) {
  const { object, status, error } = useObject(context, kind, namespace, name);
  const [activeTab, setActiveTab] = useState<string>(PANE_DETAILS);

  // Which panes have been opened at least once for the CURRENT subject — the
  // lazy-load gate for YAML and Events (see `useLoad`'s doc comment). Reset
  // whenever the subject changes, via React's documented "adjust state
  // during render" recipe: the comparison and the reset below happen before
  // this render's hooks (`useLoad`) run, so a subject switch can never fire
  // a stale fetch gated on the *previous* subject's opened panes, and a new
  // pod's YAML tab can never show the last pod's cached manifest.
  //
  // `activeTab` is deliberately NOT reset here. Which pane is selected is
  // navigation intent, not data that goes stale — the peek fills on nearly
  // every row click on an already-mounted shell, and someone comparing YAML
  // (or scanning Events) across several rows should not be thrown back to
  // Details, and charged a click to return, on every single one. It falls
  // back to Details only through the guard below (`tabs.some(...)`), for the
  // one case that genuinely needs it: the new subject's kind doesn't have
  // the pane that was selected (e.g. a Pod's Containers tab, followed by a
  // ConfigMap).
  const targetKey = `${context}|${kind}|${namespace ?? ""}|${name}`;
  const [trackedTargetKey, setTrackedTargetKey] = useState(targetKey);
  const [openedPanes, setOpenedPanes] = useState<ReadonlySet<string>>(() => new Set());
  if (targetKey !== trackedTargetKey) {
    setTrackedTargetKey(targetKey);
    // Seeded with the pane on screen right now, not emptied outright: if the
    // reader is looking at YAML or Events when the subject changes under
    // them, that pane owes them the NEW subject's data, not a permanent
    // "loading" until they re-click a tab that already looks selected. A
    // pane they are not currently on stays lazy for the new subject too.
    setOpenedPanes(new Set([activeTab]));
  }

  function selectTab(id: string) {
    setActiveTab(id);
    setOpenedPanes((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  const slug = SLUG_BY_K8S_KIND[kind];
  const descriptor = slug ? descriptorFor(slug) : undefined;
  const hasContainers = descriptor?.panes?.containers ?? false;
  const hasMetrics = descriptor?.panes?.metrics ?? false;

  // Gated on `openedPanes` alone, NOT also on `status === "ready"`: a
  // subject change cycles `status` through "loading" and back to "ready"
  // even when the pane was already open (the seeded-reset case above), and
  // ANDing that transient cycle into `enabled` toggled it true → false →
  // true, firing this effect twice for what is conceptually one refetch. The
  // object's own readiness doesn't gate this fetch — `getManifest` and
  // `listEvents` don't depend on `useObject` having succeeded, and while the
  // object is loading or has errored the pane isn't visible anyway (the
  // early returns below short-circuit before any tab renders).
  const target = [context, kind, namespace, name] as const;
  // `getManifest` needs a CRD's group/version/plural to resolve a
  // custom-resource manifest — see `resolveCrdGvk`'s own doc comment for why
  // this is looked up here rather than threaded in from a descriptor.
  const isBuiltInKind = slug !== undefined;
  // The Details pane keeps a Secret's values out of the DOM until the reader
  // reveals them; `k8s.getManifest` returns them in the clear (only
  // `k8s.getObject` redacts — see `crates/kube/src/manifest.rs`), so without
  // this the reveal gate is worth nothing to anyone who clicks one tab over.
  // The redaction goes here, on the result, rather than inside `getManifest`:
  // classic calls that same function and deliberately shows the manifest
  // unredacted, and classic is frozen. Divergence from classic here is the
  // point, not an oversight.
  const isSecret = kind === "Secret";
  const yamlState = useLoad<string>(openedPanes.has(PANE_YAML), target, async () => {
    let crd: DynamicGvk | undefined;
    if (!isBuiltInKind) {
      const resolved = await resolveCrdGvk(context, kind);
      if (resolved.error) return { error: resolved.error };
      crd = resolved.crd;
    }
    const result = await getManifest(context, kind, namespace, name, undefined, crd);
    if (result.error !== undefined || result.yaml === undefined || !isSecret) {
      return { data: result.yaml, error: result.error };
    }
    // Fails closed: on any shape it does not understand the redactor returns
    // an error and no YAML at all, which surfaces as the pane's error rather
    // than as an unredacted manifest.
    const redacted = redactSecretManifest(result.yaml);
    return redacted.error !== undefined ? { error: redacted.error } : { data: redacted.yaml };
  });
  const eventsState = useLoad<EventSummary[]>(openedPanes.has(PANE_EVENTS), target, () =>
    listEvents(context, namespace, { kind, name }).then((r) => ({ data: r.events, error: r.error })),
  );

  const subtitle = namespace ? `${kind} · ${namespace}` : kind;
  // Offered on every state, not only the settled one: a resource that is slow
  // to load, or that failed to, is exactly the one a reader wants in a tab of
  // its own rather than in a peek that the next row click will replace.
  const actions = peek && <OpenTabButton onClick={peek.onOpenTab} />;

  if (status === "loading") {
    return (
      <Inspector name={name} subtitle={subtitle} actions={actions} onClose={peek?.onClose}>
        <LoadingState label={`Loading ${describeTarget(kind, namespace, name)}`} />
      </Inspector>
    );
  }

  if (status === "error" || !object) {
    // Names the object that failed, not just "failed" — several panes can be
    // open at once, and a bare failure doesn't say which one broke.
    return (
      <Inspector name={name} subtitle={subtitle} actions={actions} onClose={peek?.onClose}>
        <ErrorState title={`Could not load ${describeTarget(kind, namespace, name)}`} detail={error} />
      </Inspector>
    );
  }

  // `Details Containers YAML Events Metrics`, the design's order. Metrics
  // trails the two panes every kind has because it is the one nothing offers
  // yet — `METRICS_BODY` is empty and no descriptor sets `panes.metrics` — and
  // getting the order right now is cheaper than remembering it later, when the
  // first kind to opt in would otherwise land it in the wrong place.
  const tabs: TabItem[] = [
    { id: PANE_DETAILS, label: "Details" },
    ...(hasContainers ? [{ id: PANE_CONTAINERS, label: "Containers" }] : []),
    { id: PANE_YAML, label: "YAML" },
    { id: PANE_EVENTS, label: "Events" },
    ...(hasMetrics ? [{ id: PANE_METRICS, label: "Metrics" }] : []),
  ];
  // Falls back to Details rather than pointing at a tab that isn't offered —
  // relevant if a kind's panes could ever shrink under a mounted shell.
  const active = tabs.some((t) => t.id === activeTab) ? activeTab : PANE_DETAILS;

  const DetailsBody = DETAILS_BODY[kind];
  const ContainersBody = CONTAINERS_BODY[kind];
  const MetricsBody = METRICS_BODY[kind];

  return (
    <Inspector
      name={name}
      subtitle={subtitle}
      {...statusHeader(kind, object)}
      actions={actions}
      tabs={tabs}
      activeTab={active}
      onTabChange={selectTab}
      tabsLabel="Resource views"
      onClose={peek?.onClose}
    >
      {active === PANE_DETAILS && (
        <GenericBody kind={kind} object={object} context={context}>
          {DetailsBody && <DetailsBody object={object} context={context} />}
        </GenericBody>
      )}
      {active === PANE_CONTAINERS && (ContainersBody ? <ContainersBody object={object} context={context} /> : null)}
      {active === PANE_METRICS && (MetricsBody ? <MetricsBody object={object} context={context} /> : null)}
      {active === PANE_YAML && (
        <YamlPane state={yamlState} kind={kind} namespace={namespace} name={name} redacted={isSecret} />
      )}
      {active === PANE_EVENTS && <EventsPane state={eventsState} kind={kind} namespace={namespace} name={name} />}
    </Inspector>
  );
}

function YamlPane({
  state,
  kind,
  namespace,
  name,
  redacted,
}: {
  state: LoadState<string>;
  kind: string;
  namespace: string | null;
  name: string;
  /** This kind's manifest went through `redactSecretManifest` — say so. */
  redacted: boolean;
}) {
  if (state.status === "loading") {
    return <LoadingState label={`Loading ${describeTarget(kind, namespace, name)}'s manifest`} />;
  }
  if (state.status === "error" || state.data === undefined) {
    return (
      <ErrorState title={`Could not load ${describeTarget(kind, namespace, name)}'s manifest`} detail={state.error} />
    );
  }
  const editor = <CodeEditor value={state.data} readOnly language="yaml" ariaLabel={`${name} manifest`} />;
  if (!redacted) return editor;
  // Told, not silently shown less: a manifest quietly missing its values
  // reads as the manifest the cluster has, and someone comparing it against
  // `kubectl get -o yaml` would have no idea why the two disagree. Tone
  // "info" is a `status` region rather than an `alert`, so it never competes
  // with this pane's own error state for a screen reader's attention.
  return (
    <div className="flex flex-col gap-2">
      <Alert tone="info" title="Values redacted">
        This Secret's values are not shown here. Reveal them one key at a time in the Details pane.
      </Alert>
      {editor}
    </div>
  );
}

const EVENT_COLUMNS: Column<EventSummary>[] = [
  {
    key: "type",
    header: "Type",
    render: (e) => <Badge tone={e.type === "Warning" ? "warn" : "muted"}>{e.type}</Badge>,
  },
  { key: "reason", header: "Reason" },
  { key: "object", header: "Object" },
  { key: "message", header: "Message" },
  { key: "age", header: "Age" },
];

function EventsPane({
  state,
  kind,
  namespace,
  name,
}: {
  state: LoadState<EventSummary[]>;
  kind: string;
  namespace: string | null;
  name: string;
}) {
  if (state.status === "loading") {
    return <LoadingState label={`Loading events for ${describeTarget(kind, namespace, name)}`} />;
  }
  if (state.status === "error" || state.data === undefined) {
    return (
      <ErrorState title={`Could not load events for ${describeTarget(kind, namespace, name)}`} detail={state.error} />
    );
  }
  // `Table` renders `emptyText` itself for a genuinely empty list — an early
  // `return null` here would leave a healthy, event-free object looking like
  // a broken pane instead of a labelled one.
  return <Table columns={EVENT_COLUMNS} data={state.data} getRowKey={(e) => e.name} emptyText="No events" />;
}
