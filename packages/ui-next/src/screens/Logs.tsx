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
  isTauri,
  logConnectionStatus,
  logLineHealth,
  logLineLevel,
  saveTextFile,
  type HealthKind,
  type LogConnectionVerdict,
  type LogLine as StreamLine,
  type LogTarget,
} from "@srelens/core";
import {
  Alert,
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
  SideRail,
  computeLogWindow,
  statusTone,
} from "@srelens/ui-kit";
import { useConsole } from "../console";
import { useActiveContext } from "../lib/clusters";
import { FailureAlert, FailureState } from "../lib/errorCopy";
import { Icons } from "../lib/icons";
import { useLogStream, type LogStreamStatus } from "../lib/logStream";
import { groupNumber } from "../lib/numbers";
import {
  resolveLogSubject,
  type LogSubject,
  type LogSubjectPod,
  type LogSubjectResolution,
} from "../lib/logSubject";
import {
  StreamRail,
  STREAM_RAIL_WIDTH,
  type StreamPod,
} from "./logs/StreamRail";
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
export function logsRoute(
  kind: string,
  namespace: string,
  name: string,
): string {
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
 * The one state this readout can be in that the CONNECTION is not.
 *
 * Everything else comes from core's `logConnectionStatus` — the four
 * connection states, each with the word and the tone core decided for it. This
 * screen writes no table of its own; it only names the state core has no
 * opinion about, because pausing is a fact about the VIEW rather than about
 * the stream, which goes on connecting, dropping and reconnecting underneath a
 * held pane. Shaped as a `LogConnectionVerdict` and toned through
 * `statusTone`, so even this one word takes its colour from core's severity
 * vocabulary rather than picking one.
 */
const PAUSED: LogConnectionVerdict = { label: "Paused", health: "neutral" };

/**
 * What the stream is doing, in a word.
 *
 * The design shows this readout only while following, so a stream that has
 * dropped says nothing at all and a reader watching a failure believes they
 * are still watching it. It is always on here, and paused is one of the states
 * it can report rather than the absence of them.
 */
function connectionSignal(
  status: LogStreamStatus,
  paused: boolean,
): LogConnectionVerdict {
  return paused ? PAUSED : logConnectionStatus(status);
}

/**
 * The connection's word and its denominator, which are one string because they
 * must never be separated.
 *
 * The aggregate flips to `reconnecting` the moment ANY single target does.
 * That is the right answer to the question the indicator exists for — *am I
 * seeing everything?* — and a badly misleading one on its own: on a ten-pod
 * workload one blip would read as a total outage. And it runs the other way
 * too, because `status` stays `connecting` until every target has reported
 * once: on a wide fan-out lines can already be scrolling while the word still
 * says connecting. The counts are what make both honest, so the word does not
 * get to appear without them.
 *
 * `Paused` carries them as well. Pausing freezes the pane, not the stream, and
 * a reader who paused and then lost half the fan-out has to be able to see it.
 *
 * `streaming` rather than `following` for the count, though `Following` is the
 * aggregate's own word: the two halves say different things — what the stream
 * as a whole is doing, and how many of its targets are actually delivering —
 * and "Following — 4 of 4 following" reads as one fact said twice.
 */
function connectionLabel(
  verdict: LogConnectionVerdict,
  live: number,
  total: number,
): string {
  return `${verdict.label} — ${live} of ${total} streaming`;
}

/**
 * Save `content` to `filename`: through the native save dialog in the desktop
 * shell, and as a browser download in web mode.
 *
 * Both halves are needed, and neither works in the other's place — a Tauri
 * webview does not prompt on `<a download>`, and a browser has no
 * `save_text_file` command to invoke. Classic reached the same conclusion
 * (`apps/desktop/src/components/LogsView.tsx`); this is that decision written
 * where the new screen can use it, not a second policy.
 */
async function saveOrDownload(
  filename: string,
  content: string,
): Promise<void> {
  if (isTauri()) {
    await saveTextFile(filename, content);
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
   * The level word AS THE LINE SPELLS IT — `error`, `WARNING`, `warn`,
   * `debug` — from {@link logLineLevel}, or `""` when the line carries none.
   *
   * This is what the level column prints, and it is deliberately not
   * {@link Row.health}: the severity vocabulary's words (`danger`,
   * `warning`) appear nowhere in the log being described, so a column showing
   * them reports something the reader cannot grep for — and `WARNING` does not
   * fit the kit's 44px gutter either. The kit turns the word into a colour
   * through its own `LEVEL_TONE`, which is why no `tone` is passed alongside
   * it: a call site that maps "error" to red itself is how the same word ends
   * up red on one screen and grey on the next.
   */
  level: string;
  /**
   * Core's severity for the line, from {@link logLineHealth} — a text-scan
   * heuristic over the same one rule the level word comes from. Not drawn;
   * it is here so the filter can match `danger` and `warning` as well as the
   * literal word the line used.
   */
  health: HealthKind;
  message: string;
  /** The line exactly as it arrived, stamp and all — what an export writes. */
  raw: string;
  /** Lower-cased message + severity word, which is what the filter matches. */
  haystack: string;
}

/** The line's origin as one string: `api-7 · api` on screen, `api-7/api` in a
 *  file, and the pod alone for a stream with no container to disambiguate. */
function sourceOf(row: Row, separator: string): string {
  return row.container === ""
    ? row.pod
    : `${row.pod}${separator}${row.container}`;
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
  const pod =
    line.source === ""
      ? (only?.pod ?? "")
      : slash < 0
        ? line.source
        : line.source.slice(0, slash);
  const container =
    line.source === ""
      ? (only?.container ?? "")
      : slash < 0
        ? ""
        : line.source.slice(slash + 1);
  const health = logLineHealth(message);
  return {
    ts,
    pod,
    container,
    level: logLineLevel(message) ?? "",
    health,
    message,
    raw: line.text,
    haystack: `${message} ${health}`.toLowerCase(),
  };
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
  const [resolution, setResolution] = useState<LogSubjectResolution | null>(
    null,
  );

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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAttempt((a) => a + 1)}
            >
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
      // Fetched with the targets, not for the rail: the pod objects were
      // already on the wire here for their containers, and their status and
      // labels came back on the same round trip.
      pods={resolution.pods}
    />
  );
}

function LogsStream({
  context,
  clusterName,
  namespace,
  name,
  targets,
  pods,
}: {
  context: string;
  clusterName: string;
  namespace: string;
  name: string;
  targets: LogTarget[];
  pods: LogSubjectPod[];
}) {
  const { ask } = useConsole();
  const [text, setText] = useState("");
  const [since, setSince] = useState("5m");
  const [container, setContainer] = useState(ALL_CONTAINERS);
  const [wrap, setWrap] = useState(false);
  const [metrics, setMetrics] = useState({
    scrollTop: 0,
    viewportHeight: 0,
    rowHeight: 0,
  });
  /** The pods whose boxes the reader has unticked. Names, not indices: the
   *  rail is rebuilt on every render and an index means nothing across one. */
  const [hidden, setHidden] = useState<readonly string[]>([]);
  /** Which restart the reader has already been told about. */
  const [seenRestart, setSeenRestart] = useState(0);
  /** Why the last export did not land, if it did not. */
  const [saveError, setSaveError] = useState<unknown>(undefined);

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
  const rows = useMemo(
    () => stream.lines.map((l) => toRow(l, only)),
    [stream.lines, only],
  );

  const containers = useMemo(
    () =>
      [
        ...new Set(
          targets.map((t) => t.container ?? "").filter((c) => c !== ""),
        ),
      ].sort(),
    [targets],
  );

  const query = text.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (hidden.includes(row.pod)) return false;
        if (container !== ALL_CONTAINERS && row.container !== container)
          return false;
        if (query !== "" && !row.haystack.includes(query)) return false;
        return true;
      }),
    [rows, hidden, container, query],
  );

  const togglePod = useCallback((pod: string, checked: boolean) => {
    setHidden((current) =>
      checked
        ? current.filter((p) => p !== pod)
        : current.includes(pod)
          ? current
          : [...current, pod],
    );
  }, []);

  /** Puts every filter back, the pod boxes among them — otherwise the state
   *  that reports "no lines match" cannot undo the tick that caused it. */
  const clearFilters = useCallback(() => {
    setText("");
    setContainer(ALL_CONTAINERS);
    setHidden([]);
  }, []);

  const railPods = useMemo<StreamPod[]>(
    () =>
      pods.map((pod) => ({
        name: pod.name,
        // The label is the screen's copy; the hash is the fact. Spread rather
        // than `revision: undefined`, so an absent label stays absent instead
        // of arriving as a present-but-empty figure.
        ...(pod.revision === undefined
          ? {}
          : { revision: `rev ${pod.revision}` }),
        checked: !hidden.includes(pod.name),
        // core's verdict, decided once in `resolveLogSubject`. The rail is
        // told; it does not work this out, and neither does this screen.
        tone: pod.health,
      })),
    [pods, hidden],
  );

  /**
   * What the rail tallies: THE LINES THE BODY IS DRAWING, with every filter
   * applied — and each one's RFC3339 stamp already off.
   *
   * The stamp is the trap. A stamped line opens with a digit, `tallyLogTerms`
   * reads a leading digit as a value and ends the term run there, so a stamped
   * buffer tallies to NOTHING — no error, no warning, just an empty rail that
   * looks exactly like a quiet log. `row.message` is the stripped text; the
   * raw line never goes near this.
   */
  const railLines = useMemo<StreamLine[]>(
    () => filtered.map((row) => ({ source: row.pod, text: row.message })),
    [filtered],
  );

  /**
   * Export what is ON SCREEN.
   *
   * `filtered`, not the buffer: the reader narrowed to the thing they are
   * looking at, and a file that quietly contains the nine thousand lines they
   * filtered out is not the thing they asked for. The whole of `filtered`
   * rather than the drawn window, though — the window is an artefact of how
   * far they happen to have scrolled, not of what they chose to look at.
   *
   * Each line goes out RAW, stamp and all, in classic's `source | line`
   * shape. The column on screen truncates the stamp to `14:07:41.208` because
   * a reader watching a live tail knows what day it is; a file read tomorrow
   * does not, and the full RFC3339 is what makes an exported line greppable
   * against anything else. Which lines are exported is what "on screen"
   * governs — not how much of each one an 86px gutter had room for.
   *
   * While paused, `lines` is the frozen view, so this exports exactly the
   * pane the reader paused. That is the point: someone who pauses on a
   * failure and exports means "this, the thing I stopped on", not "this plus
   * the nine hundred lines that arrived while I was reading it".
   */
  function exportView() {
    setSaveError(undefined);
    const content = filtered
      .map((row) => `${sourceOf(row, "/")} | ${row.raw}`)
      .join("\n");
    void saveOrDownload(`${name}.log`, content).catch((e: unknown) =>
      setSaveError(e),
    );
  }

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
        : {
            scrollTop: viewport.scrollTop,
            viewportHeight: viewport.clientHeight,
            rowHeight,
          },
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
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
      STICK_SLACK;
    measure();
  }

  const signal = connectionSignal(stream.status, stream.paused);
  const restarted = stream.restartCount > seenRestart;
  const window_ = computeLogWindow({
    total: filtered.length,
    scrollTop: metrics.scrollTop,
    viewportHeight: metrics.viewportHeight,
    rowHeight: metrics.rowHeight,
    wrap,
  });
  const drawn = window_.virtualized
    ? filtered.slice(window_.start, window_.end)
    : filtered;
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
          {/* Disabled on an empty view rather than hidden: a control that
              vanishes leaves the reader wondering whether this screen exports
              at all, where a greyed one says "yes, once there is something to
              export". Classic disabled it on the same condition. */}
          <Button
            variant="secondary"
            size="sm"
            onClick={exportView}
            disabled={filtered.length === 0}
          >
            Export
          </Button>
        </>
      }
    >
      <SideRail
        head="Stream"
        width={STREAM_RAIL_WIDTH}
        rail={
          <StreamRail
            pods={railPods}
            lines={railLines}
            onTogglePod={togglePod}
          />
        }
      >
        <FilterBar
          value={text}
          onValueChange={setText}
          label="Filter lines"
          placeholder="Filter lines"
        >
          <div className="flex items-center gap-1.5">
            <Eyebrow>since</Eyebrow>
            <Select
              value={since}
              onValueChange={setSince}
              options={SINCE_OPTIONS}
              aria-label="since"
            />
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
            <Eyebrow>
              {groupNumber(stream.pendingWhilePaused)} new lines
            </Eyebrow>
          )}
          <LiveSignal
            label={connectionLabel(
              signal,
              stream.liveTargets,
              stream.totalTargets,
            )}
            tone={statusTone(signal.health)}
          />
        </FilterBar>

        {restarted && (
          // A `since` change reopens the stream, and the reader loses every line
          // they had scrolled through. The hook counts those restarts precisely
          // so this is sayable; without it the pane simply empties and a reader
          // who had found the line they came for believes the log did.
          <Alert
            tone="warn"
            title="Scrollback cleared"
            onDismiss={() => setSeenRestart(stream.restartCount)}
            dismissLabel="Dismiss the scrollback notice"
            className="mx-3 mt-3"
          >
            Changing the window reopens the stream, and the lines it had already
            delivered are not sent again. srelens is following from here.
          </Alert>
        )}

        {saveError !== undefined && (
          <FailureAlert
            title="Could not save this stream"
            error={saveError}
            className="mx-3 mt-3"
          />
        )}

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
                <Button variant="secondary" size="sm" onClick={clearFilters}>
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
              {window_.topPad > 0 && (
                <div style={{ height: window_.topPad }} aria-hidden="true" />
              )}
              {drawn.map((row, i) => (
                // The index is the key: two identical lines a second apart are
                // ordinary in a log, so nothing in a line is a stable identity.
                <LogLine
                  key={window_.start + i}
                  ts={row.ts}
                  source={sourceOf(row, " · ")}
                  // The word the LINE used, from core's one level scan — never
                  // the severity vocabulary's name for it, which appears nowhere
                  // in the log the reader is grepping against.
                  //
                  // And no `tone` beside it. The kit owns level→tone precisely
                  // so the same word is not red here and grey on the next
                  // screen; an override belongs to a line singled out for some
                  // reason OTHER than its level, and none is.
                  level={row.level}
                  message={row.message}
                />
              ))}
              {window_.bottomPad > 0 && (
                <div style={{ height: window_.bottomPad }} aria-hidden="true" />
              )}
            </div>
          )}
        </div>
      </SideRail>
    </LogsScreen>
  );
}
