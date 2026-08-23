import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
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
  type ResourceStatusLine,
} from "@srelens/core";
import {
  Alert,
  Badge,
  Button,
  CodeEditor,
  ErrorState,
  FactGrid,
  Inspector,
  LoadingState,
  Table,
  type Column,
  type InspectorProps,
  type TabItem,
} from "@srelens/ui-kit";
import { Icons } from "../../lib/icons";
import { CUSTOM_RESOURCE_ACTIONS } from "../../lib/kinds/custom";
import { descriptorFor } from "../../lib/kinds/descriptors";
import { useObject } from "../../lib/useObject";
import { ConfigDetailsBody } from "./ConfigBody";
import { CronJobDetailsBody } from "./CronJobBody";
import { DetailActions } from "./DetailActions";
import { GenericBody } from "./GenericBody";
import { JobDetailsBody } from "./JobBody";
import { NodeDetailsBody } from "./NodeBody";
import { PodContainersBody, PodContainersTable, PodDetailsBody } from "./PodBody";
import { AnnotationsSection, LabelsSection } from "./sections";
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

/**
 * `kind` is the route's, not `object.kind`. A body dispatched on one kind and
 * reading another off the payload is two sources of truth for the fact its own
 * dispatch turned on — live today only because the API server happens to
 * return `kind` on a single-object GET. A body that does not need it simply
 * omits it from its own props. (#331)
 */
type PaneBody = (props: { kind: string; object: K8sObject; context: string }) => ReactNode;

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
export const DETAILS_BODY: Record<string, PaneBody> = {
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

/**
 * The full tab's INLINE containers table — the same kinds as
 * {@link CONTAINERS_BODY}, in the summary form the design draws on Overview.
 *
 * A kind opts into containers ONCE, through its descriptor's
 * `panes.containers`; these two tables only say what a container looks like on
 * each surface. A kind that sets the flag and has no entry here shows no
 * table rather than a broken one, which is the same answer the peek gives for
 * a missing `CONTAINERS_BODY`.
 */
const CONTAINERS_TABLE: Record<string, (props: { object: K8sObject }) => ReactNode> = {
  Pod: PodContainersTable,
};

type LoadStatus = "loading" | "ready" | "error";

interface LoadState<T> {
  status: LoadStatus;
  data?: T;
  error?: string;
}

/**
 * A pane's own data, loaded only once that pane has actually been opened for
 * the CURRENT `target`. Exported for the full tab, whose metric strip fetches
 * pod usage under the very same rule — one lazy, target-gated load, not a
 * second one written to look like it — `enabled` is the caller's "the reader has looked at
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
export function useLoad<T>(
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
 * The design's third header line, for a kind that has one. The peek's; the
 * full tab draws the same verdict as a strip of metric tiles instead, off the
 * very same `ResourceStatusLine` — {@link useDetailPanes} reads it once and
 * hands it to whichever host is drawing, so the two can never disagree.
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
  line: ResourceStatusLine | null,
  object: K8sObject,
): Pick<InspectorProps, "status" | "statusKind" | "facts" | "flagged"> {
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
 * Which of the two surfaces is drawing. Not a look — a different screen: the
 * peek is a column beside a list and the tab is a page, and the design draws
 * them differently on purpose (see `mock-detail-fulltab.md`).
 */
export type DetailHost = "peek" | "tab";

/** Everything a host needs to draw one subject, and nothing about how. */
export interface DetailPanes {
  object?: K8sObject;
  status: ReturnType<typeof useObject>["status"];
  error?: string;
  /** The kind's own row actions and extra panes, or `undefined` for a CRD. */
  descriptor: ReturnType<typeof descriptorFor>;
  /** Core's one verdict on this subject — the peek's status line and the
   *  tab's metric strip are two renderings of it, never two readings. */
  statusLine: ResourceStatusLine | null;
  tabs: TabItem[];
  active: string;
  selectTab: (id: string) => void;
  /** The active pane, ready to seat in whatever chrome the host draws. */
  pane: ReactNode;
}

/**
 * One subject's panes: what to fetch, when to fetch it, which panes a kind
 * offers, and what each of them renders — everything about a resource detail
 * except what it looks like.
 *
 * THE HOSTS ARE NOT ONE PANE ANY MORE. Spec rule R-5 said the peek and the
 * full tab were the same component differing by one prop; the user's full-tab
 * mock retired it, and they now have their own chrome, their own tab labels
 * and their own Overview layout. What survives is the discipline underneath
 * it, and it lives here: one read of the object, one lazy-load rule per pane,
 * one target gate, one table of per-kind bodies. A fact shown in both places
 * is derived once, so the two can differ in how they read and never in what
 * they say.
 *
 * `host` reaches only three decisions — the first pane's label, whether
 * Containers is a tab of its own or a table inline on Overview, and how the
 * facts are laid out. Everything else below is the same code for both.
 */
export function useDetailPanes({
  context,
  kind,
  namespace,
  name,
  host,
}: {
  context: string;
  kind: string;
  namespace: string | null;
  name: string;
  host: DetailHost;
}): DetailPanes {
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
  // A tab of its own in the peek; inline on the full tab's Overview, which is
  // where the design puts it. Either way it is the kind's descriptor that says
  // the kind HAS containers — never a branch on the kind's name here.
  const hasContainers = descriptor?.panes?.containers ?? false;
  const hasMetrics = descriptor?.panes?.metrics ?? false;
  const inPeek = host === "peek";

  // Gated on `openedPanes` alone, NOT also on `status === "ready"`: a
  // subject change cycles `status` through "loading" and back to "ready"
  // even when the pane was already open (the seeded-reset case above), and
  // ANDing that transient cycle into `enabled` toggled it true → false →
  // true, firing this effect twice for what is conceptually one refetch. The
  // object's own readiness doesn't gate this fetch — `getManifest` and
  // `listEvents` don't depend on `useObject` having succeeded, and while the
  // object is loading or has errored the pane isn't visible anyway (the
  // hosts' own early returns short-circuit before any tab renders).
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

  // `Details Containers YAML Events Metrics` in the peek; `Overview YAML
  // Events Metrics` in the tab, where the containers table is inline. Metrics
  // trails the panes every kind has because it is the one nothing offers yet —
  // `METRICS_BODY` is empty and no descriptor sets `panes.metrics` — and
  // getting the order right now is cheaper than remembering it later, when the
  // first kind to opt in would otherwise land it in the wrong place. Relations
  // and Drill, which the full-tab mock also names, are deferred and have no
  // body at all: a strip names a pane only when there is something behind it.
  const tabs: TabItem[] = [
    { id: PANE_DETAILS, label: inPeek ? "Details" : "Overview" },
    ...(inPeek && hasContainers ? [{ id: PANE_CONTAINERS, label: "Containers" }] : []),
    { id: PANE_YAML, label: "YAML" },
    { id: PANE_EVENTS, label: "Events" },
    ...(hasMetrics ? [{ id: PANE_METRICS, label: "Metrics" }] : []),
  ];
  // Falls back to Details rather than pointing at a tab that isn't offered —
  // relevant when a kind's panes shrink under a mounted shell, and when the
  // reader promotes a peek that was showing Containers into a tab that has no
  // such pane.
  const active = tabs.some((t) => t.id === activeTab) ? activeTab : PANE_DETAILS;

  const DetailsBody = DETAILS_BODY[kind];
  const ContainersBody = CONTAINERS_BODY[kind];
  const MetricsBody = METRICS_BODY[kind];
  const meta = object?.metadata ?? {};

  // The per-kind body, identical in both hosts. Only its surroundings differ.
  const body = object && (
    <GenericBody kind={kind} object={object} context={context}>
      {DetailsBody && <DetailsBody kind={kind} object={object} context={context} />}
    </GenericBody>
  );
  // Labels and Annotations close every kind's detail, so the HOST places them
  // rather than each body rendering its own — the peek stacks them under the
  // rest and the tab reads them side by side, and a body that drew them itself
  // could only ever produce one of those. `kind` stays required on
  // `AnnotationsSection` for the reason its own comment gives: a Secret's
  // annotation can be the secret, and no caller may get that gate by default.
  const labels = <LabelsSection labels={meta.labels ?? {}} />;
  const annotations = <AnnotationsSection kind={kind} annotations={meta.annotations ?? {}} />;

  let pane: ReactNode = null;
  if (object) {
    if (active === PANE_DETAILS) {
      pane = inPeek ? (
        // A flat run of sibling sections, which is what draws the hairlines
        // between them (`.section + .section`). Nothing may be wrapped around
        // any one of them.
        <>
          {body}
          {labels}
          {annotations}
        </>
      ) : (
        <FactGrid>
          {body}
          {/* Inline, per the mock, and only for a kind whose descriptor says
              it has containers — the same fact the peek turns into a tab. */}
          {hasContainers && CONTAINERS_TABLE[kind] !== undefined &&
            createElement(CONTAINERS_TABLE[kind], { object })}
          {/* Two columns, and each wrapped, so neither section is the other's
              adjacent sibling — `.section + .section` would otherwise rule
              down the middle of the row instead of across it. */}
          <div data-slot="metadata-pair" className="rule-t grid grid-cols-2">
            <div>{labels}</div>
            <div className="rule-l">{annotations}</div>
          </div>
        </FactGrid>
      );
    } else if (active === PANE_CONTAINERS) {
      pane = ContainersBody ? <ContainersBody kind={kind} object={object} context={context} /> : null;
    } else if (active === PANE_METRICS) {
      pane = MetricsBody ? <MetricsBody kind={kind} object={object} context={context} /> : null;
    }
  }
  if (active === PANE_YAML) {
    pane = <YamlPane state={yamlState} kind={kind} namespace={namespace} name={name} redacted={isSecret} />;
  } else if (active === PANE_EVENTS) {
    pane = <EventsPane state={eventsState} kind={kind} namespace={namespace} name={name} />;
  }

  return {
    object,
    status,
    error,
    descriptor,
    statusLine: object ? resourceStatusLine(kind, object) : null,
    tabs,
    active,
    selectTab,
    pane,
  };
}

/**
 * The detail PEEK: one subject, identified at the top, its panes beneath, its
 * actions along the bottom — the pane `mock-detail-pane.md` draws, inside the
 * resource list.
 *
 * It used to be both hosts. Spec rule R-5 said the peek and the full tab were
 * the same component with the same props, and that was true of the pane the
 * first mock drew; the user's second mock draws the tab as a different screen
 * — a breadcrumb header, actions in the header row, a metric strip, a
 * three-column fact grid — and retired the rule. `ResourceTab` is that screen.
 *
 * What the two still share is everything that is not a look, and it is shared
 * through {@link useDetailPanes} rather than by being written twice: one read
 * of the object, one lazy-load rule per pane, one target gate, one table of
 * per-kind bodies, one set of actions. So a fact can be laid out differently
 * in the two hosts and cannot be derived differently.
 */
export function ResourceDetail({ context, kind, namespace, name, peek }: ResourceDetailProps) {
  const { object, status, error, descriptor, statusLine, tabs, active, selectTab, pane } =
    useDetailPanes({ context, kind, namespace, name, host: "peek" });

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

  // Read once: the header draws the verdict, and the footer's Ask asks a
  // different question of an unhealthy subject than of a healthy one.
  const header = statusHeader(statusLine, object);

  return (
    <Inspector
      name={name}
      subtitle={subtitle}
      {...header}
      actions={actions}
      tabs={tabs}
      activeTab={active}
      onTabChange={selectTab}
      tabsLabel="Resource views"
      onClose={peek?.onClose}
      // The design's bar. Nothing about it comes from `peek`: the actions a
      // subject offers are the kind's, not the host's, and the full tab draws
      // the very same row in its header through the very same component. It is
      // not offered on the loading or error states above — Suspend/Resume
      // reads the object's own `spec`, and half of these actions are writes
      // against something the pane could not even read.
      footer={
        <DetailActions
          context={context}
          kind={kind}
          namespace={namespace}
          name={name}
          // A kind outside `K8S_KIND` has no descriptor at all, which is
          // precisely the custom-resource case — so it inherits the very
          // action set `customDescriptor` gives one, Delete withheld and all.
          actions={descriptor?.actions ?? CUSTOM_RESOURCE_ACTIONS}
          flagged={header.flagged ?? false}
          suspended={object.spec?.suspend === true}
        />
      }
    >
      {pane}
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
  // The height, which the pane got wrong until #331's second round. Three
  // things have to hold together and only the last of them is obvious:
  //
  // - `fill` on the editor. Without it the kit's `CodeEditor` grows with its
  //   content up to `maxHeight`, which defaults to 520px — a little under 28
  //   lines of 12px type at a 1.55 line height, which is exactly where the
  //   manifest was being cut, with the rest of the pane left blank beneath
  //   it. Its own wrapper's `h-full` did not save it: `height` and
  //   `max-height` are different properties, and the cap wins the used height.
  // - a column that owns the pane's height (`h-full`), so the notice and the
  //   editor divide it rather than stack inside an auto-height box.
  // - `min-h-0` on the editor's seat. `fill` resolves to `height: 100%`,
  //   which is nothing at all against a parent whose own height is auto, and
  //   a flex child's default `min-height: auto` refuses to shrink below its
  //   content — the pair of them is what makes the editor scroll internally
  //   instead of pushing the notice off the top.
  //
  // Same slot either way, so the redacted case is one more row in the column
  // rather than a second layout to keep in step.
  return (
    <div data-slot="yaml-editor" className="flex h-full flex-col gap-2">
      {/* Told, not silently shown less: a manifest quietly missing its values
          reads as the manifest the cluster has, and someone comparing it
          against `kubectl get -o yaml` would have no idea why the two
          disagree. Tone "info" is a `status` region rather than an `alert`, so
          it never competes with this pane's own error state for a screen
          reader's attention. */}
      {redacted && (
        <Alert tone="info" title="Values redacted">
          This Secret's values are not shown here. Reveal them one key at a time in the Details pane.
        </Alert>
      )}
      <div className="min-h-0 flex-1">
        <CodeEditor value={state.data} readOnly language="yaml" fill ariaLabel={`${name} manifest`} />
      </div>
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
