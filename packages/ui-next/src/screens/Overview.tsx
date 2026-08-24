import { useCallback, useMemo, useState } from "react";
import {
  copyKubectlCommand,
  cordonNode,
  drainNode,
  formatStorageSize,
  notify,
  podStatus,
  toKubectl,
  type ClusterCapacity,
  type ClusterContext,
  type HealthKind,
  type NodeSummary,
  type NodeUsage,
  type PodSummary,
} from "@srelens/core";
import {
  ActionBar,
  Button,
  ConfirmDialog,
  ErrorState,
  KubectlPreview,
  LoadingState,
  Meter,
  Panel,
  Screen,
  Stat,
  StatusPill,
  Table,
  loadTone,
  statusTone,
  type ActionBarAction,
  type Column,
  type Tone,
} from "@srelens/ui-kit";
import { useConsole } from "../console";
import { useActiveContext } from "../lib/clusters";
import { detailRoute } from "../lib/detailRoute";
import { Icons } from "../lib/icons";
import { nodeVerdict, podFlagged } from "../lib/kinds/columns";
import { ROW_ACTION_LABEL } from "../lib/kinds/rowActions";
import { UnhealthyDot } from "../lib/kinds/rowAffordances";
import { useOverview, type Overview as OverviewData, type OverviewNodes } from "../lib/overview";
import { describe } from "../lib/routes";
import { openTab } from "../lib/tabsStore";
import { NoClusterScreen } from "./resourceShell";

/**
 * What a figure says when there is no reading behind it.
 *
 * `null` from `nodeUsage`/`clusterCapacity` means nobody measured — no
 * metrics-server, a node that has not been scraped, a list that was refused.
 * `0%` is a measurement, and it reads as an idle cluster; an empty meter reads
 * as one too. This screen is the last layer, and the place the distinction
 * would be lost, so absence gets words rather than a zero.
 *
 * The words say only that there is no reading, never why. WHY is the rail's to
 * state, once — a screen where five tiles and two columns each announce a
 * missing metrics-server has said it seven times and explained it nowhere.
 */
const NO_READING = "No reading";

/** A fact the cluster did not carry. Never a guess in its place. */
const UNKNOWN = "—";

/** The header's one action, verbatim from the design (§7). */
const SUMMARISE_LABEL = "Summarise";
const SUMMARISE = "Summarise the health of this cluster";

/** This screen's own words for the two node actions. Nothing else renders them. */
const NODE_ACTION_LABEL = {
  cordon: "Cordon",
  uncordon: "Uncordon",
  drain: "Drain",
} as const;

/** One node, flattened so the table can key, sort and filter on its fields. */
type NodeRow = NodeSummary & { usage: NodeUsage };

/**
 * `/overview` — the cluster overview (§7).
 *
 * Two of its three left-hand sections are here: the capacity strip and the
 * nodes table. `Not ready` and the `At a glance` rail arrive with their own
 * tasks and slot in where this file says so.
 *
 * Split in two the way `Events.tsx` and `Workloads.tsx` are: with no cluster
 * in focus there is no context name to load anything for, and a hook cannot be
 * skipped, so the guard returns before any of them runs.
 */
export function Overview({ route }: { route: string }) {
  const context = useActiveContext();
  const title = describe(route, context?.name).title;

  if (!context) {
    return <NoClusterScreen title={title} noun="nodes" />;
  }

  return <ClusterOverview title={title} context={context} />;
}

function ClusterOverview({ title, context }: { title: string; context: ClusterContext }) {
  // Core takes a context *name*; the workspace holds a `stableId`. The two are
  // never interchangeable — see `lib/clusters`.
  const name = context.name;
  const overview = useOverview(name);
  const { ask } = useConsole();
  const Sparkle = Icons.ask;

  // `<cluster name> / <provider>`, and just the name until the facts answer.
  // A provider row that said "unknown" would look like an answer; an absent
  // one says nothing, which is what the cluster said.
  const provider = overview.facts.facts?.provider ?? "";

  return (
    <Screen
      title={title}
      eyebrow={provider ? `${name} / ${provider}` : name}
      actions={
        // Exactly one header action, per §7. A `Button` rather than the row's
        // `AskChip` for the reason `Events.tsx` gives: the chip is invisible
        // until its row is hovered, which is right for one of forty rows and
        // invisible on a toolbar. The visible word is the design's; the
        // question it will actually send is the accessible name.
        <Button
          type="button"
          size="sm"
          aria-label={`${SUMMARISE_LABEL}: ${SUMMARISE}`}
          title={`${SUMMARISE_LABEL}: ${SUMMARISE}`}
          onClick={() => ask(SUMMARISE)}
        >
          <Sparkle size={12} aria-hidden="true" />
          {SUMMARISE_LABEL}
        </Button>
      }
    >
      {/* A column of sections. The `Not ready` list belongs after the table,
          and the `At a glance` rail wraps this column — each with its own
          task, and neither needs any state held here. */}
      <div className="flex flex-col gap-3">
        <Capacity overview={overview} />
        <Nodes context={name} nodes={overview.nodes} />
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------------- capacity */

/** A tile's figure, and the caption that carries the tone. */
interface Tile {
  value: string;
  caption?: string;
  tone?: Tone;
}

/**
 * The five figures across the top: Nodes, Pods, Namespaces, CPU, Memory.
 *
 * **The caption carries the tone, never the figure.** `Stat` spends its tone
 * on the delta alone for the same reason: a row of five coloured numbers shows
 * the reader nothing about which one to look at, and the judgement — `all
 * ready`, `8 not ready`, `312 / 460 cores` — is what the colour belongs to.
 *
 * Every section reads its own loader, so a refused namespace list empties one
 * tile and leaves the other four with their numbers.
 */
function Capacity({ overview }: { overview: OverviewData }) {
  const nodes = nodesTile(overview.nodes);
  const pods = podsTile(overview.pods.pods);
  const namespaces = overview.namespaces.count;
  const cpu = cpuTile(overview.nodes.capacity);
  const memory = memoryTile(overview.nodes.capacity);

  return (
    <Panel title="Capacity">
      {/* The row sizes the tiles rather than each tile sizing itself: `Stat`
          cannot be given a width through `className` (two utilities that both
          set `flex` resolve by stylesheet order), so the grid does it. */}
      <div data-slot="capacity" className="grid grid-cols-5 gap-3">
        <Stat label="Nodes" value={nodes.value} delta={nodes.caption} tone={nodes.tone} />
        <Stat label="Pods" value={pods.value} delta={pods.caption} tone={pods.tone} />
        {/* The one tile the design gives no caption: a namespace count has no
            judgement attached to it. */}
        <Stat label="Namespaces" value={namespaces === null ? NO_READING : String(namespaces)} />
        <Stat label="CPU" value={cpu.value} delta={cpu.caption} tone={cpu.tone} />
        <Stat label="Memory" value={memory.value} delta={memory.caption} tone={memory.tone} />
      </div>
    </Panel>
  );
}

/**
 * How many nodes there are, and what is the matter with them.
 *
 * The partition and the tone both come from core's `nodeStatus` (through
 * `nodeVerdict`), never from a word this file pairs with a colour: a NotReady
 * node is `danger` there and a cordoned one is `warning`, and calling a
 * cordoned node "not ready" would be a second, wronger reading of a verdict
 * core already made. `statusTone` maps the health to the kit's token, and is
 * exported precisely so nobody keeps a private copy of that map.
 */
function nodesTile(nodes: OverviewNodes): Tile {
  if (nodes.status === "loading" || nodes.error) return { value: NO_READING };

  const verdicts = nodes.nodes.map((row) => nodeVerdict(row.node));
  if (verdicts.length === 0) return { value: "0" };

  const value = String(verdicts.length);
  const notReady = verdicts.filter((v) => v.health === "danger").length;
  if (notReady > 0) return { value, caption: `${notReady} not ready`, tone: statusTone("danger") };

  const cordoned = verdicts.filter((v) => v.flagged).length;
  if (cordoned > 0) return { value, caption: `${cordoned} cordoned`, tone: statusTone("warning") };

  return { value, caption: "all ready", tone: statusTone("success") };
}

/**
 * How many pods there are, and how many need a second look.
 *
 * `podFlagged` is core's `podStatus` — the same reading the pod list's dot and
 * the pod detail's header take, so a pod counted here as unhealthy is the one
 * the `Not ready` list will name. `undefined` pods means the list has not
 * answered (or was refused), which is not an empty cluster.
 */
function podsTile(pods: PodSummary[] | undefined): Tile {
  if (!pods) return { value: NO_READING };
  const value = String(pods.length);
  if (pods.length === 0) return { value };

  const flagged = pods.filter(podFlagged);
  if (flagged.length === 0) return { value, caption: "all ready", tone: statusTone("success") };
  return { value, caption: `${flagged.length} not ready`, tone: statusTone(worst(flagged)) };
}

/**
 * The worst health among the pods that are flagged — what tones their count.
 *
 * Read off the same `podStatus` that flagged them: a Pending pod is amber and
 * a crash-looping one is red, and a count that mixed them takes the redder of
 * the two rather than a colour this file chose.
 */
function worst(flagged: PodSummary[]): HealthKind {
  return flagged.some((pod) => podStatus(pod.phase, pod.waitingReason).health === "danger")
    ? "danger"
    : "warning";
}

function cpuTile(capacity: ClusterCapacity): Tile {
  const cpu = capacity.cpu;
  if (!cpu || cpu.allocatableMillicores === 0) return { value: NO_READING };
  const percent = (cpu.usedMillicores / cpu.allocatableMillicores) * 100;
  return {
    value: `${Math.round(percent)}%`,
    caption: `${cores(cpu.usedMillicores)} / ${cores(cpu.allocatableMillicores)} cores${partial(capacity)}`,
    tone: loadTone(percent),
  };
}

function memoryTile(capacity: ClusterCapacity): Tile {
  const memory = capacity.memory;
  if (!memory || memory.allocatableMiB === 0) return { value: NO_READING };
  const percent = (memory.usedMiB / memory.allocatableMiB) * 100;
  return {
    value: `${Math.round(percent)}%`,
    caption: `${mib(memory.usedMiB)} / ${mib(memory.allocatableMiB)}${partial(capacity)}`,
    tone: loadTone(percent),
  };
}

/**
 * What qualifies a total that is not the whole cluster's.
 *
 * `clusterCapacity` sums only the nodes that reported a metric — a node with
 * no reading is left out of both halves of the ratio rather than folded in as
 * an idle one — so whenever `nodesReporting` falls short of `nodesTotal` the
 * figure above describes part of the cluster. It carries the shortfall on the
 * return value for exactly this: a partial total shown bare reads as a whole
 * one, and nothing else on screen would contradict it.
 */
function partial(capacity: ClusterCapacity): string {
  if (capacity.nodesReporting >= capacity.nodesTotal) return "";
  return ` · ${capacity.nodesReporting} of ${capacity.nodesTotal} nodes reporting`;
}

/** Millicores as cores, to one decimal place and no trailing zero: `8.4`, `12`. */
function cores(millicores: number): string {
  return String(Math.round(millicores / 100) / 10);
}

/** MiB through core's own binary-size formatter, so `35.2Gi` reads as it does elsewhere. */
function mib(value: number): string {
  return formatStorageSize(`${value}Mi`);
}

/* ------------------------------------------------------------------- nodes */

function Nodes({ context, nodes }: { context: string; nodes: OverviewNodes }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rows: NodeRow[] = nodes.nodes.map(({ node, usage }) => ({ ...node, usage }));

  // Stable, so the column set below is built once per context rather than per
  // render — `Table` re-sorts whenever its `columns` identity changes.
  const open = useCallback((next: Pending) => {
    setError("");
    setPending(next);
  }, []);
  const columns = useMemo(() => nodeColumns(context, open), [context, open]);

  function close() {
    setPending(null);
    setError("");
  }

  /**
   * The action itself, taken only from the confirm.
   *
   * Nothing in `actions` below calls core: every pick opens the dialog, and
   * only this runs. That is what makes "no node is cordoned or drained
   * without a confirm" true by construction rather than by each button
   * remembering — the same split `ResourceMenu`'s `pending` makes for the row
   * menu's destructive entries, and the reason `ConfirmDialog` and
   * `KubectlPreview` are the kit's rather than this screen's own.
   */
  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError("");

    if (pending.type === "drain") {
      const out = await drainNode(context, pending.name);
      setBusy(false);
      // A refused write leaves the dialog up with the reason in it, rather
      // than closing as if the node had been drained.
      if (out.error) {
        setError(out.error);
        return;
      }
      notify.success(`Drained ${pending.name}`, `${out.evicted ?? 0} evicted, ${out.skipped ?? 0} skipped`);
    } else {
      const out = await cordonNode(context, pending.name, pending.unschedulable);
      setBusy(false);
      if (out.error) {
        setError(out.error);
        return;
      }
      notify.success(`${pending.unschedulable ? "Cordoned" : "Uncordoned"} ${pending.name}`);
    }

    close();
    // The node's own `unschedulable` has changed; the table is what shows it.
    nodes.reload();
  }

  return (
    <Panel title="Nodes">
      {nodes.status === "loading" ? (
        <LoadingState label="Loading nodes" />
      ) : nodes.error ? (
        // The node list, and only it. A missing metrics-server is held apart
        // by the loader (`metricsError`) precisely so it cannot empty this
        // table; those rows keep their columns and read as no reading.
        <ErrorState
          title={`Could not list nodes on ${context}`}
          detail={nodes.error}
          onRetry={nodes.reload}
        />
      ) : (
        <Table
          columns={columns}
          data={rows}
          getRowKey={(row) => row.name}
          emptyText="No nodes"
          emptyHint={`Nothing in ${context} reported a node.`}
        />
      )}
      {pending && (
        <NodeConfirm
          pending={pending}
          context={context}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={close}
        />
      )}
    </Panel>
  );
}

/**
 * The node's pool — the machine type it was created from.
 *
 * `NodeSummary` carries name, status, taints, version, roles, age and the
 * allocatable trio, and no labels at all, so the
 * `node.kubernetes.io/instance-type` label this column reads is not on the
 * wire today and every cell shows nothing. That is the design's own answer for
 * a node without the label, and the column is deliberately NOT filled from
 * something else that happens to be present: the mock's pools (`c3-standard`
 * out of `eu-w4-c3-standard-a1`) are a naming convention, and `roles` is a
 * different fact entirely. A guess here would be read as the machine type the
 * cluster is billed for. One label on `NodeSummary` fills it in.
 */
function pool(_node: NodeRow): string {
  return "";
}

/** The percentage a meter draws, or the words that say there is none. */
function reading(percent: number | null, ariaLabel: string) {
  if (percent === null) return NO_READING;
  // Straight through, unrounded and uncapped. `Meter` clamps the bar it draws
  // while keeping `aria-valuetext` truthful and rounds only what it shows, so
  // rounding or clamping here would make a node at 140% indistinguishable
  // from one exactly at its limit — hiding the case worth seeing.
  return <Meter value={percent} ariaLabel={ariaLabel} />;
}

/** `31/50`, or no reading — including for a node that reported no capacity. */
function podsRead(pods: NodeUsage["pods"]): string {
  // `{ used: 31, allocatable: 0 }` is a node that reported no allocatable pod
  // capacity. `31/0` is not a ratio, and it reads as a node overrun rather
  // than as a denominator nobody supplied.
  if (!pods || pods.allocatable === 0) return NO_READING;
  return `${pods.used}/${pods.allocatable}`;
}

function nodeColumns(context: string, open: (pending: Pending) => void): Column<NodeRow>[] {
  return [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {nodeVerdict(row).flagged ? (
            <UnhealthyDot />
          ) : (
            // The dot's width, kept so a healthy node's name lines up under a
            // flagged one's rather than sliding left.
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0" />
          )}
          <span className="truncate">{row.name}</span>
        </span>
      ),
    },
    { key: "pool", header: "Pool", sortable: true, getValue: pool, render: (row) => pool(row) || UNKNOWN },
    {
      key: "state",
      header: "State",
      sortable: true,
      getValue: (row) => nodeVerdict(row).status,
      // The word AND the tone are core's `nodeStatus`, through the same
      // `nodeVerdict` the nodes list reads — including the cordoned case,
      // which it spells the way kubectl does. `tinted` is the design's
      // asymmetry: the word is coloured only when core called the state bad.
      render: (row) => {
        const verdict = nodeVerdict(row);
        return <StatusPill status={verdict.status} kind={verdict.health} tinted />;
      },
    },
    {
      key: "cpu",
      header: "CPU",
      sortable: true,
      // `-1` puts a node with no reading below every real one, rather than in
      // among the idle ones — the same rule the nodes list sorts metrics by.
      getSortValue: (row) => row.usage.cpuPercent ?? -1,
      render: (row) => reading(row.usage.cpuPercent, `${row.name} CPU`),
    },
    {
      key: "memory",
      header: "Memory",
      sortable: true,
      getSortValue: (row) => row.usage.memoryPercent ?? -1,
      render: (row) => reading(row.usage.memoryPercent, `${row.name} memory`),
    },
    {
      key: "pods",
      header: "Pods",
      sortable: true,
      align: "end",
      getSortValue: (row) => row.usage.pods?.used ?? -1,
      render: (row) => podsRead(row.usage.pods),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      filterable: false,
      render: (row) => (
        <ActionBar actions={nodeActions(context, row, open)} label={`Actions for ${row.name}`} max={2} />
      ),
    },
  ];
}

/**
 * The row's actions: two on the bar and the rest behind the overflow, which is
 * the design's own shape for this table.
 *
 * A cordoned node is offered the other direction rather than the same action
 * again — the state is on the row, so the button can say what it will do.
 * `Node shell` is in the design's overflow and is not here: it needs the
 * ephemeral debug-pod flow, which this screen has no path to, and an action
 * that cannot work is worse than one that is absent.
 */
function nodeActions(context: string, row: NodeRow, open: (pending: Pending) => void): ActionBarAction[] {
  const kubectlBase = { kind: "Node", name: row.name, namespace: null, context } as const;
  return [
    row.unschedulable
      ? {
          id: "uncordon",
          label: NODE_ACTION_LABEL.uncordon,
          onSelect: () => open({ type: "cordon", name: row.name, unschedulable: false }),
        }
      : {
          id: "cordon",
          label: NODE_ACTION_LABEL.cordon,
          onSelect: () => open({ type: "cordon", name: row.name, unschedulable: true }),
        },
    {
      id: "drain",
      label: NODE_ACTION_LABEL.drain,
      // Danger-toned because it is: every pod on the node is evicted.
      danger: true,
      onSelect: () => open({ type: "drain", name: row.name }),
    },
    {
      id: "open",
      label: ROW_ACTION_LABEL.openTab,
      onSelect: () => openTab(detailRoute("Node", null, row.name), { clusterName: context }),
    },
    {
      id: "copy",
      label: ROW_ACTION_LABEL.copy,
      onSelect: () => void copyKubectlCommand(toKubectl({ ...kubectlBase, action: "get", output: "yaml" })),
    },
  ];
}

/* ---------------------------------------------------------------- confirms */

/** What a picked action is waiting to do, once the confirm is taken. */
type Pending =
  | { type: "cordon"; name: string; unschedulable: boolean }
  | { type: "drain"; name: string };

function NodeConfirm({
  pending,
  context,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  pending: Pending;
  context: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const drain = pending.type === "drain";
  const label = drain
    ? NODE_ACTION_LABEL.drain
    : pending.unschedulable
      ? NODE_ACTION_LABEL.cordon
      : NODE_ACTION_LABEL.uncordon;
  const command = toKubectl({
    action: drain ? "drain" : pending.unschedulable ? "cordon" : "uncordon",
    kind: "Node",
    name: pending.name,
    namespace: null,
    context,
  });

  return (
    <ConfirmDialog
      title={`${label} node?`}
      // Cordoning is a reversible scheduling change with a button that undoes
      // it; draining evicts every pod on the node. Only one of the two is
      // destructive, and colouring both would say nothing about either.
      danger={drain}
      busy={busy}
      confirmLabel={label}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p style={{ marginTop: 0 }}>
            {drain ? (
              <>
                Drain <code>{pending.name}</code>? This evicts every pod on the node and stops new
                ones being scheduled to it.
              </>
            ) : pending.unschedulable ? (
              <>
                Cordon <code>{pending.name}</code>? No new pods will be scheduled to it; the pods
                already running there stay.
              </>
            ) : (
              <>
                Uncordon <code>{pending.name}</code>? It becomes schedulable again.
              </>
            )}
          </p>
          <KubectlPreview command={command} onCopy={() => void copyKubectlCommand(command)} />
          {error && <p style={{ color: "var(--sev)" }}>Error: {error}</p>}
        </>
      }
    />
  );
}
