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
 * The Details pane's per-kind content — empty today. Tasks 10-13 each append
 * one entry here, keyed on `k8sKind` (e.g. `Pod: PodDetailView`), as they
 * port a family of classic's `ResourceOverview` bodies. A kind absent from
 * the table (every kind, right now) falls through to `Inspector`'s own
 * "nothing to show" state — a table for later tasks to extend, not a switch
 * for this component to grow.
 */
const DETAILS_BODY: Record<string, PaneBody> = {};

/** Same seam, for the Containers pane a kind's descriptor opts into via
 *  `panes.containers` (Task 10, for Pod). */
const CONTAINERS_BODY: Record<string, PaneBody> = {};

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
 * A pane's own data, loaded independently of the object once it is ready —
 * the same generation-counter guard `useObject` uses against a stale result
 * landing after the target changed. Keyed on the target alone, never on
 * which pane is active, so switching tabs back and forth never re-fires it.
 */
function useLoad<T>(
  enabled: boolean,
  target: readonly [string, string, string | null, string],
  load: () => Promise<{ data?: T; error?: string }>,
): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const gen = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const mine = ++gen.current;
    setState({ status: "loading" });
    load().then(
      (result) => {
        if (gen.current !== mine) return;
        if (result.error) {
          setState({ status: "error", error: result.error });
          return;
        }
        setState({ status: "ready", data: result.data });
      },
      (e: unknown) => {
        if (gen.current !== mine) return;
        setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      if (gen.current === mine) gen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...target]);

  return state;
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

  const slug = SLUG_BY_K8S_KIND[kind];
  const descriptor = slug ? descriptorFor(slug) : undefined;
  const hasContainers = descriptor?.panes?.containers ?? false;
  const hasMetrics = descriptor?.panes?.metrics ?? false;

  const ready = status === "ready";
  const target = [context, kind, namespace, name] as const;
  const yamlState = useLoad<string>(ready, target, () =>
    getManifest(context, kind, namespace, name).then((r) => ({ data: r.yaml, error: r.error })),
  );
  const eventsState = useLoad<EventSummary[]>(ready, target, () =>
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
      onTabChange={setActiveTab}
      tabsLabel="Resource views"
      onClose={onClose}
    >
      {active === PANE_DETAILS && (DetailsBody ? <DetailsBody object={object} context={context} /> : null)}
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
  if (state.data.length === 0) return null;
  return <Table columns={EVENT_COLUMNS} data={state.data} getRowKey={(e) => e.name} emptyText="No events" />;
}
