import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  logLineHealth,
  type HealthKind,
  type LogLine as StreamLine,
  type LogTarget,
} from "@srelens/core";
import {
  AskChip,
  Button,
  EmptyState,
  Eyebrow,
  FilterBar,
  LiveSignal,
  LoadingState,
  LogLine,
  Screen,
  Select,
  computeLogWindow,
  statusTone,
  type Tone,
} from "@srelens/ui-kit";
import { useConsole } from "../console";
import { useActiveContext } from "../lib/clusters";
import { FailureState } from "../lib/errorCopy";
import { Icons } from "../lib/icons";
import { useLogStream, type LogStreamStatus } from "../lib/logStream";
import { resolveLogSubject, type LogSubject, type LogSubjectResolution } from "../lib/logSubject";
import { NoClusterScreen } from "./resourceShell";

/**
 * `/logs/<kind>/<namespace>/<name>` — the live tail of a workload's pods, or
 * of one pod.
 *
 * The subject is in the route rather than in a store because `openTab` dedupes
 * by route string, so the route IS the stream's identity: two workloads
 * followed at once must be two tabs, and the same one opened twice must be
 * one. Same reasoning, and the same four-segment shape, as `detailRoute`.
 */
export function logsRoute(kind: string, namespace: string, name: string): string {
  return `/logs/${encodeURIComponent(kind)}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}

export interface LogsRouteParts {
  /** `Pod` for a single pod; any workload kind `getObject` understands otherwise. */
  kind: string;
  namespace: string;
  name: string;
}

/**
 * The inverse of {@link logsRoute}. Counts segments rather than
 * pattern-matching, because a decoded name can contain anything — including a
 * `/`, which is why every segment is encoded on the way in.
 *
 * A bare `/logs` parses to `null` rather than to a subject nobody named; the
 * screen has its own copy for that.
 */
export function parseLogsRoute(route: string): LogsRouteParts | null {
  const segments = route.split("/");
  if (segments.length !== 5) return null;
  const [empty, prefix, rawKind, rawNamespace, rawName] = segments;
  if (empty !== "" || prefix !== "logs") return null;
  if (!rawKind || !rawNamespace || !rawName) return null;
  return {
    kind: decodeURIComponent(rawKind),
    namespace: decodeURIComponent(rawNamespace),
    name: decodeURIComponent(rawName),
  };
}

/** The `since` windows the design offers, and what each one means in seconds. */
const SINCE: { value: string; seconds: number | undefined }[] = [
  { value: "5m", seconds: 300 },
  { value: "15m", seconds: 900 },
  { value: "1h", seconds: 3600 },
  // `all` is the absence of a window, not a very large one: the backend takes
  // `null` and hands back everything the container still has.
  { value: "all", seconds: undefined },
];
const SINCE_OPTIONS = SINCE.map((s) => ({ value: s.value, label: s.value }));

/**
 * How many trailing lines a connect asks for.
 *
 * A ceiling rather than a preference. `since=all` on a container that has been
 * up for a week would otherwise open with its entire history, all of which but
 * the last few thousand lines is immediately dropped by the ring anyway — so
 * the only thing an unbounded first connect buys is the wait.
 */
const TAIL_LINES = 1000;

/** Stands for "every container", as a select value that cannot be a name. */
const ALL_CONTAINERS = "";

/** How near the bottom still counts as being at it, in pixels. Classic's 48. */
const STICK_SLACK = 48;

/**
 * **Provisional, and the only place in this file that turns a connection state
 * into a word and a colour.**
 *
 * Core owns every status vocabulary in this app — `k8sStatus.ts`, `k8sHealth.ts`
 * — but all of them describe Kubernetes *resources*, and a log stream's
 * connection is not one. There is nothing to import yet, so this screen writes
 * it; it is written as one record so the word and the tone are decided
 * together and no call site can pair them itself, exactly as `LINK_WORD` /
 * `LINK_TONE` (`lib/workspace.ts`) are for the cluster link.
 *
 * When core grows a verdict for stream connection status, this constant and
 * {@link connectionSignal} are the whole of what has to be repointed.
 */
const CONNECTION: Record<LogStreamStatus, { label: string; tone: Tone }> = {
  connecting: { label: "Connecting", tone: "info" },
  live: { label: "Following", tone: "ok" },
  reconnecting: { label: "Reconnecting", tone: "warn" },
  error: { label: "Stream stopped", tone: "sev" },
};

/**
 * What the stream is doing, in a word.
 *
 * The design shows this readout only while following, so a stream that has
 * dropped says nothing at all and a reader watching a failure believes they
 * are still watching it. It is always on here, and paused is one of the states
 * it can report rather than the absence of them.
 */
function connectionSignal(status: LogStreamStatus, paused: boolean): { label: string; tone: Tone } {
  return paused ? { label: "Paused", tone: "muted" } : CONNECTION[status];
}

/**
 * `2026-08-24T14:07:41.208123456Z ` — what the backend prefixes each line with
 * when a stream is opened with `timestamps: true`, which this screen always is
 * because the design gives the time its own column.
 */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(\.\d+)?Z? ?/;

/** One line as the body draws it: the four columns, plus what a filter reads. */
interface Row {
  /** `14:07:41.208`, or `""` for a line that arrived without a stamp. */
  ts: string;
  pod: string;
  container: string;
  /**
   * Core's severity for the line, from {@link logLineHealth} — a text-scan
   * heuristic, because a stream carries no structured level field. `neutral`
   * is "no level word in this line", NOT an error, and renders as an empty
   * level column rather than as a word.
   */
  health: HealthKind;
  message: string;
  /** Lower-cased message + severity word, which is what the filter matches. */
  haystack: string;
}

/**
 * Split a stream line into the columns the design draws.
 *
 * `source` is the target's own `label`, which `resolveLogSubject` leaves empty
 * when there is exactly one target — so a single-container stream falls back
 * to that target rather than drawing a nameless source.
 */
function toRow(line: StreamLine, only: LogTarget | undefined): Row {
  const stamp = line.text.match(RFC3339);
  const ts = stamp ? `${stamp[1]}${(stamp[2] ?? "").slice(0, 4)}` : "";
  const message = stamp ? line.text.slice(stamp[0].length) : line.text;
  const slash = line.source.indexOf("/");
  const pod = line.source === "" ? (only?.pod ?? "") : slash < 0 ? line.source : line.source.slice(0, slash);
  const container =
    line.source === "" ? (only?.container ?? "") : slash < 0 ? "" : line.source.slice(slash + 1);
  const health = logLineHealth(message);
  return {
    ts,
    pod,
    container,
    health,
    message,
    haystack: `${message} ${health}`.toLowerCase(),
  };
}

/**
 * Grouped the way the design writes numbers — a space every three digits, by
 * hand rather than through `toLocaleString`, which would put a comma in it
 * under one locale and a full stop under another. (Same rule as `AppLog`.)
 */
function groupNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** `3 pods`, `1 pod` — counted over distinct pods, not over targets: a pod
 *  running three containers is three targets and one pod. */
function podCount(targets: readonly LogTarget[]): string {
  const pods = new Set(targets.map((t) => t.pod)).size;
  return `${pods} ${pods === 1 ? "pod" : "pods"}`;
}

/** The screen's frame, shared by every state it can be in. */
function LogsScreen({
  eyebrow,
  actions,
  children,
}: {
  eyebrow: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Screen title="Logs" eyebrow={eyebrow} fill actions={actions}>
      {children}
    </Screen>
  );
}

export function Logs({ route }: { route: string }) {
  const cluster = useActiveContext();
  const parts = parseLogsRoute(route);

  if (!cluster) return <NoClusterScreen title="Logs" noun="logs" />;

  if (!parts) {
    // A bare `/logs`. The doors that carry a subject are the row menu's
    // *Follow logs* and the detail screen's *Logs*; this is the one someone
    // opens by accident, and it names what it needs instead of streaming
    // from nowhere. Task 9 adds the recently-streamed subjects as a way in.
    return (
      <LogsScreen eyebrow={cluster.name}>
        <EmptyState
          title="Pick a workload or a pod to follow"
          hint="srelens tails every container behind a Deployment, StatefulSet, DaemonSet or Job — or one pod on its own. Open one from Workloads and choose Follow logs."
          className="flex-1"
        />
      </LogsScreen>
    );
  }

  return (
    // Keyed on the subject: a different workload is a different stream, and
    // remounting is how its buffer, filters and scroll position start clean
    // rather than inheriting the last one's.
    <LogsSubject
      key={`${cluster.stableId}:${route}`}
      context={cluster.name}
      clusterName={cluster.name}
      {...parts}
    />
  );
}

/**
 * Resolving the route's subject to the pods and containers to follow, and
 * saying why it could not.
 *
 * The stream is not opened until every in-scope pod's containers are known —
 * `resolveLogSubject` is all-or-nothing for exactly this reason — so the
 * streaming half of the screen is a separate component that only mounts once
 * there are targets. That also means a `since` change cannot re-resolve the
 * subject: the lookup lives above the state that drives the stream.
 */
function LogsSubject({
  context,
  clusterName,
  kind,
  namespace,
  name,
}: LogsRouteParts & { context: string; clusterName: string }) {
  const [attempt, setAttempt] = useState(0);
  const [resolution, setResolution] = useState<LogSubjectResolution | null>(null);

  const subject = useMemo<LogSubject>(
    () =>
      kind.toLowerCase() === "pod"
        ? { type: "pod", context, namespace, name }
        : { type: "workload", context, namespace, kind, name },
    [context, namespace, kind, name],
  );

  useEffect(() => {
    let alive = true;
    setResolution(null);
    void resolveLogSubject(subject).then((next) => {
      if (alive) setResolution(next);
    });
    return () => {
      alive = false;
    };
  }, [subject, attempt]);

  const head = `${clusterName} / ${namespace} / ${name}`;

  if (resolution === null) {
    return (
      <LogsScreen eyebrow={head}>
        <LoadingState label="Finding the containers to follow" />
      </LogsScreen>
    );
  }

  if (resolution.status === "error") {
    return (
      <LogsScreen eyebrow={head}>
        {/* The classification's own `raw`, not the FriendlyError: `describeError`
            is idempotent over it, so this goes through the one error path this
            package has rather than opening a second. */}
        <FailureState
          title={`Could not open logs for ${name}`}
          error={resolution.error.raw}
          onRetry={() => setAttempt((a) => a + 1)}
          className="m-3"
        />
      </LogsScreen>
    );
  }

  if (resolution.status === "empty") {
    return (
      <LogsScreen eyebrow={head}>
        <EmptyState
          title="Nothing to follow"
          hint={resolution.detail}
          action={
            <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)}>
              Look again
            </Button>
          }
          className="flex-1"
        />
      </LogsScreen>
    );
  }

  return (
    <LogsStream
      context={context}
      clusterName={clusterName}
      namespace={namespace}
      name={name}
      targets={resolution.targets}
    />
  );
}

function LogsStream({
  context,
  clusterName,
  namespace,
  name,
  targets,
}: {
  context: string;
  clusterName: string;
  namespace: string;
  name: string;
  targets: LogTarget[];
}) {
  const { ask } = useConsole();
  const [text, setText] = useState("");
  const [since, setSince] = useState("5m");
  const [container, setContainer] = useState(ALL_CONTAINERS);
  const [wrap, setWrap] = useState(false);
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: 0, rowHeight: 0 });

  const viewportRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  /**
   * Whether new lines should move the view. Held in a ref, not state: it is
   * written from a scroll handler that fires far more often than the screen
   * renders, and read by a layout effect that must see the value from the
   * scroll that just happened, not from the render before it.
   */
  const stickRef = useRef(true);

  const sinceSeconds = SINCE.find((s) => s.value === since)?.seconds;
  const stream = useLogStream(context, namespace, targets, {
    // Always on: the design gives the time its own column, so the stamp is not
    // an option the reader turns on — it is where the first column comes from.
    timestamps: true,
    sinceSeconds,
    tailLines: TAIL_LINES,
  });

  const only = targets.length === 1 ? targets[0] : undefined;
  const rows = useMemo(() => stream.lines.map((l) => toRow(l, only)), [stream.lines, only]);

  const containers = useMemo(
    () => [...new Set(targets.map((t) => t.container ?? "").filter((c) => c !== ""))].sort(),
    [targets],
  );

  const query = text.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (container !== ALL_CONTAINERS && row.container !== container) return false;
        if (query !== "" && !row.haystack.includes(query)) return false;
        return true;
      }),
    [rows, container, query],
  );

  // Sample the viewport and one row so the render can window the list. Both
  // degrade to 0 in jsdom, which `computeLogWindow` reads as "render
  // everything" — one of the bail-outs that make it correct.
  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const firstRow = rowsRef.current?.querySelector<HTMLElement>(".logline");
    const rowHeight = firstRow ? firstRow.getBoundingClientRect().height : 0;
    setMetrics((m) =>
      m.scrollTop === viewport.scrollTop &&
      m.viewportHeight === viewport.clientHeight &&
      m.rowHeight === rowHeight
        ? m
        : { scrollTop: viewport.scrollTop, viewportHeight: viewport.clientHeight, rowHeight },
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measure, filtered.length, wrap]);

  /**
   * Stick to bottom, and the reason it is a threshold rather than a flag the
   * reader sets: following is the default, and the moment someone scrolls up
   * is the moment they are reading the line that made them open the screen.
   * Yanking them back to the newest line there loses exactly the thing they
   * were looking at, and no amount of "scroll down to resume" copy makes that
   * acceptable — so arriving lines move the view only while the view is
   * already at the end of the buffer.
   */
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !stickRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [filtered, wrap]);

  function trackScroll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    stickRef.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < STICK_SLACK;
    measure();
  }

  const signal = connectionSignal(stream.status, stream.paused);
  const window_ = computeLogWindow({
    total: filtered.length,
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportHeight,
    rowHeight: metrics.rowHeight,
    wrap,
  });
  const drawn = window_.virtualized ? filtered.slice(window_.start, window_.end) : filtered;
  const windowLabel = since === "all" ? "" : ` in the last ${since}`;

  return (
    <LogsScreen
      eyebrow={`${clusterName} / ${namespace} / ${name} · ${podCount(targets)}`}
      actions={
        <>
          <AskChip
            label="Summarise this stream"
            question="Summarise the last 500 log lines and group errors by cause"
            onAsk={ask}
          />
          <Button variant="secondary" size="sm" onClick={stream.togglePause}>
            {stream.paused ? (
              <Icons.play size={13} aria-hidden="true" />
            ) : (
              <Icons.pause size={13} aria-hidden="true" />
            )}
            {stream.paused ? "Follow" : "Pause"}
          </Button>
        </>
      }
    >
      <FilterBar value={text} onValueChange={setText} label="Filter lines" placeholder="Filter lines">
        <div className="flex items-center gap-1.5">
          <Eyebrow>since</Eyebrow>
          <Select value={since} onValueChange={setSince} options={SINCE_OPTIONS} aria-label="since" />
        </div>
        {containers.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Eyebrow>container</Eyebrow>
            <Select
              value={container}
              onValueChange={setContainer}
              options={[
                { value: ALL_CONTAINERS, label: "all" },
                ...containers.map((c) => ({ value: c })),
              ]}
              aria-label="container"
            />
          </div>
        )}
        <Button
          variant="secondary"
          size="xs"
          aria-pressed={wrap}
          onClick={() => setWrap((w) => !w)}
          // The design draws every message `break-all`, which makes every row a
          // different height and defeats the windowing outright — 5,000 wrapped
          // rows in the DOM, re-rendered on every line that arrives. Unwrapped
          // is the default so the arithmetic holds; the toggle is here because
          // without it a line wider than the pane has no way to be read at all,
          // and the design offers none.
        >
          Wrap
        </Button>
        <span className="flex-1" />
        {stream.paused && stream.pendingWhilePaused > 0 && (
          <Eyebrow>{groupNumber(stream.pendingWhilePaused)} new lines</Eyebrow>
        )}
        <LiveSignal label={signal.label} tone={signal.tone} />
      </FilterBar>

      <div
        ref={viewportRef}
        onScroll={trackScroll}
        role="log"
        aria-label={`${name} logs`}
        className={`scroll min-h-0 flex-1 py-1 font-mono text-[0.75rem] leading-[1.85] ${
          wrap ? "" : "whitespace-nowrap"
        }`}
      >
        {stream.status === "error" && stream.error ? (
          <FailureState
            title={`Could not follow ${name}'s logs`}
            error={stream.error.raw}
            className="m-3"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing has been logged yet"
            hint={`srelens is following ${targets.length} container${targets.length === 1 ? "" : "s"} across ${podCount(targets)}; none of them has written a line${windowLabel}.`}
          />
        ) : filtered.length === 0 ? (
          // Deliberately not the sentence above it. "Nothing yet" and "nothing
          // matching" are different facts with different remedies, and one
          // message for both tells a reader their filter is fine when it is
          // the only thing hiding the line they came for.
          <EmptyState
            title="No lines match"
            hint={`${groupNumber(rows.length)} line${rows.length === 1 ? " is" : "s are"} in the buffer; none of them matches this filter.`}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setText("");
                  setContainer(ALL_CONTAINERS);
                }}
              >
                Clear the filter
              </Button>
            }
          />
        ) : (
          <div ref={rowsRef}>
            {stream.dropped > 0 && (
              // The ring bit. A reader who scrolls to the top of a capped
              // buffer is not at the beginning of the log, and silence here
              // would let them believe they are.
              <div className="px-2.5 py-1 text-muted">
                Showing the newest {groupNumber(filtered.length)} lines ·{" "}
                {groupNumber(stream.dropped)} earlier lines dropped
              </div>
            )}
            {window_.topPad > 0 && <div style={{ height: window_.topPad }} aria-hidden="true" />}
            {drawn.map((row, i) => (
              // The index is the key: two identical lines a second apart are
              // ordinary in a log, so nothing in a line is a stable identity.
              <LogLine
                key={window_.start + i}
                ts={row.ts}
                source={row.container === "" ? row.pod : `${row.pod} · ${row.container}`}
                // Core's severity word and core's severity colour, from the one
                // `logLineHealth` scan — never a level the screen spells itself.
                // `neutral` means the line carries no level word, so it gets an
                // empty column rather than being called anything.
                level={row.health === "neutral" ? "" : row.health}
                tone={statusTone(row.health)}
                message={row.message}
              />
            ))}
            {window_.bottomPad > 0 && (
              <div style={{ height: window_.bottomPad }} aria-hidden="true" />
            )}
          </div>
        )}
      </div>
    </LogsScreen>
  );
}
