import { useEffect, useRef, useState, type ReactNode } from "react";
import { K8S_KIND, getManifest, listEvents, type EventSummary, type K8sObject } from "@srelens/core";
import {
  Badge,
  CodeEditor,
  ErrorState,
  Inspector,
  LoadingState,
  Table,
  type Column,
  type TabItem,
} from "@srelens/ui-kit";
import { descriptorFor } from "../../lib/kinds/descriptors";
import { useObject } from "../../lib/useObject";
import { CronJobDetailsBody } from "./CronJobBody";
import { GenericBody } from "./GenericBody";
import { JobDetailsBody } from "./JobBody";
import { NodeDetailsBody } from "./NodeBody";
import { PodContainersBody, PodDetailsBody } from "./PodBody";
import { ServiceDetailsBody } from "./ServiceBody";
import { WorkloadDetailsBody } from "./WorkloadBody";

export interface ResourceDetailProps {
  context: string;
  /** The Kubernetes kind ("Pod", "Deployment", ...) — the same value
   *  `detailRoute` and `useObject` take, not the list screen's slug. */
  kind: string;
  namespace: string | null;
  name: string;
  /**
   * Present only in the peek host — the tab host has its own way to close a
   * tab and leaves this off. Nothing else here may vary on its presence: the
   * peek and the tab are the same pane in two hosts (R-5), and this is the
   * one prop that tells them apart.
   */
  onClose?: () => void;
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
 * never a different pane. The peek passes `onClose`; the tab does not; that
 * is the ONLY thing either host varies. Everything on screen comes from
 * `useObject`, the single read both hosts share, which is what makes it
 * impossible for the peek and the tab to disagree about what they show.
 *
 * Which extra panes a kind offers (Containers, Metrics) comes off its
 * `KindDescriptor` — never a branch on `kind` in this component. The
 * Details/Containers/Metrics pane bodies are per-kind content that Tasks
 * 10-13 port in; see the `*_BODY` tables above for the seam they fill.
 */
export function ResourceDetail({ context, kind, namespace, name, onClose }: ResourceDetailProps) {
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
  const yamlState = useLoad<string>(openedPanes.has(PANE_YAML), target, () =>
    getManifest(context, kind, namespace, name).then((r) => ({ data: r.yaml, error: r.error })),
  );
  const eventsState = useLoad<EventSummary[]>(openedPanes.has(PANE_EVENTS), target, () =>
    listEvents(context, namespace, { kind, name }).then((r) => ({ data: r.events, error: r.error })),
  );

  const subtitle = namespace ? `${kind} · ${namespace}` : kind;

  if (status === "loading") {
    return (
      <Inspector name={name} subtitle={subtitle} onClose={onClose}>
        <LoadingState label={`Loading ${describeTarget(kind, namespace, name)}`} />
      </Inspector>
    );
  }

  if (status === "error" || !object) {
    // Names the object that failed, not just "failed" — several panes can be
    // open at once, and a bare failure doesn't say which one broke.
    return (
      <Inspector name={name} subtitle={subtitle} onClose={onClose}>
        <ErrorState title={`Could not load ${describeTarget(kind, namespace, name)}`} detail={error} />
      </Inspector>
    );
  }

  const tabs: TabItem[] = [
    { id: PANE_DETAILS, label: "Details" },
    ...(hasContainers ? [{ id: PANE_CONTAINERS, label: "Containers" }] : []),
    ...(hasMetrics ? [{ id: PANE_METRICS, label: "Metrics" }] : []),
    { id: PANE_YAML, label: "YAML" },
    { id: PANE_EVENTS, label: "Events" },
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
      tabs={tabs}
      activeTab={active}
      onTabChange={selectTab}
      tabsLabel="Resource views"
      onClose={onClose}
    >
      {active === PANE_DETAILS && (
        <GenericBody kind={kind} object={object} context={context}>
          {DetailsBody && <DetailsBody object={object} context={context} />}
        </GenericBody>
      )}
      {active === PANE_CONTAINERS && (ContainersBody ? <ContainersBody object={object} context={context} /> : null)}
      {active === PANE_METRICS && (MetricsBody ? <MetricsBody object={object} context={context} /> : null)}
      {active === PANE_YAML && <YamlPane state={yamlState} kind={kind} namespace={namespace} name={name} />}
      {active === PANE_EVENTS && <EventsPane state={eventsState} kind={kind} namespace={namespace} name={name} />}
    </Inspector>
  );
}

function YamlPane({
  state,
  kind,
  namespace,
  name,
}: {
  state: LoadState<string>;
  kind: string;
  namespace: string | null;
  name: string;
}) {
  if (state.status === "loading") {
    return <LoadingState label={`Loading ${describeTarget(kind, namespace, name)}'s manifest`} />;
  }
  if (state.status === "error" || state.data === undefined) {
    return (
      <ErrorState title={`Could not load ${describeTarget(kind, namespace, name)}'s manifest`} detail={state.error} />
    );
  }
  return <CodeEditor value={state.data} readOnly language="yaml" ariaLabel={`${name} manifest`} />;
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
