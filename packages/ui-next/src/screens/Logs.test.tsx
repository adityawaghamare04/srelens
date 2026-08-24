import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The two things this screen reaches outside itself for: the subject lookup
 * that turns a route into pods and containers, and the stream hook that owns
 * the buffer. Both are mocked wholesale.
 *
 * Mocking the HOOK rather than `startLogStream` underneath it is deliberate.
 * `logStream.test.ts` already pins what the hook does with a burst, a pause
 * and an unmount; what is left for this suite is what the SCREEN does with
 * what the hook returns — which lines it draws, which it filters out, what it
 * asks the hook for, and where the viewport ends up when new ones arrive.
 * Driving that through a real subscription would put a backend transport in
 * the way of every one of those assertions.
 */
const h = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    listeners,
    version: 0,
    /** What the hook currently reports, mutated by the helpers below. */
    state: {
      lines: [] as { source: string; text: string }[],
      dropped: 0,
      status: "live" as "connecting" | "live" | "reconnecting" | "error",
      error: undefined as { title: string; detail: string; raw: string } | undefined,
      paused: false,
      pending: 0,
    },
    /** Every call the screen has made into the hook, in order. */
    seen: [] as {
      context: string;
      namespace: string;
      targets: { pod: string; container?: string; label?: string }[];
      options: { sinceSeconds?: number; tailLines?: number; timestamps?: boolean };
    }[],
    resolve: vi.fn(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("../lib/logSubject", async (orig) => ({
  ...(await orig<typeof import("../lib/logSubject")>()),
  resolveLogSubject: (...a: unknown[]) => h.resolve(...a),
}));

vi.mock("../lib/logStream", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useLogStream: (
      context: string,
      namespace: string,
      targets: { pod: string; container?: string; label?: string }[],
      options: { sinceSeconds?: number; tailLines?: number; timestamps?: boolean } = {},
    ) => {
      useSyncExternalStore(
        h.subscribe,
        () => h.version,
        () => h.version,
      );
      h.seen.push({ context, namespace, targets, options });
      return {
        lines: h.state.lines,
        dropped: h.state.dropped,
        status: h.state.status,
        error: h.state.error,
        paused: h.state.paused,
        pendingWhilePaused: h.state.pending,
        togglePause: () => {
          h.state.paused = !h.state.paused;
          h.state.pending = 0;
          notify();
        },
        clear: () => {
          h.state.lines = [];
          notify();
        },
        restartCount: 0,
      };
    },
  };
});

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import type { ClusterContext, LogTarget } from "@srelens/core";
import { describeError } from "@srelens/core";
import { Logs, logsRoute, parseLogsRoute } from "./Logs";
import { ConsoleProvider, useConsole } from "../console";
import { resetContexts, setContexts, setKubeconfigFiles } from "../lib/clusters";
import { defaultState } from "../lib/tabs";
import * as store from "../lib/tabsStore";

/** Push the version forward and wake every mounted hook. */
function notify() {
  h.version += 1;
  for (const listener of [...h.listeners]) listener();
}

const CTX: ClusterContext = {
  name: "prod-eu",
  stableId: "prod",
  cluster: "prod",
  server: "https://prod",
  isCurrent: true,
};

/**
 * Three pods, four containers — the shape the header's pod count exists for.
 * `api-7` runs two containers, so a naive `targets.length` would call this
 * four pods.
 */
const TARGETS: LogTarget[] = [
  { pod: "api-7", container: "api", label: "api-7/api" },
  { pod: "api-7", container: "otel-sidecar", label: "api-7/otel-sidecar" },
  { pod: "api-8", container: "api", label: "api-8/api" },
  { pod: "api-9", container: "api", label: "api-9/api" },
];

const ROUTE = logsRoute("Deployment", "checkout", "checkout-api");

/** A stream line as the backend sends it with `timestamps: true`. */
const line = (source: string, ts: string, text: string) => ({
  source,
  text: `2026-08-24T${ts}Z ${text}`,
});

const LINES = [
  line("api-7/api", "14:07:41.208000000", "info starting checkout-api build=4f2a1c"),
  line("api-7/otel-sidecar", "14:07:42.100000000", "warn exporter queue is full"),
  line("api-8/api", "14:07:43.900000000", "error pool timeout waited=30.0s in_use=5"),
  line("api-9/api", "14:07:44.010000000", "GET /healthz 200 1ms"),
];

beforeEach(() => {
  vi.clearAllMocks();
  h.listeners.clear();
  h.version = 0;
  h.seen = [];
  h.state = { lines: [], dropped: 0, status: "live", error: undefined, paused: false, pending: 0 };
  h.resolve.mockResolvedValue({ status: "resolved", targets: TARGETS });

  resetContexts();
  setContexts([CTX]);
  setKubeconfigFiles(["/home/u/.kube/config"]);
  store.setState(defaultState([CTX]));
});

let asked: string[] = [];

/** Records what the ask chip put to the console, which has no dock here. */
function AskSpy() {
  const console_ = useConsole();
  console_.registerSubmit((question) => {
    asked.push(question);
  });
  return null;
}

function draw(route = ROUTE) {
  asked = [];
  return render(
    <ConsoleProvider>
      <AskSpy />
      <Logs route={route} />
    </ConsoleProvider>,
  );
}

/** The rendered lines as `ts|source|level|message`, in order. */
const rendered = (region: HTMLElement) =>
  Array.from(region.querySelectorAll(".logline")).map((el) =>
    ["ts", "source", "level", "message"]
      .map((slot) => el.querySelector(`[data-slot=${slot}]`)?.textContent ?? "")
      .join("|"),
  );

/** Push lines into the buffer the screen is rendering. */
function push(...lines: { source: string; text: string }[]) {
  act(() => {
    h.state.lines = [...h.state.lines, ...lines];
    notify();
  });
}

const body = () => screen.findByRole("log", { name: /logs/i });

/** The last options the screen asked the stream hook for. */
const lastOptions = () => h.seen[h.seen.length - 1].options;

describe("the logs route", () => {
  it("round-trips a subject through the route it mints", () => {
    expect(parseLogsRoute(logsRoute("Deployment", "checkout", "checkout-api"))).toEqual({
      kind: "Deployment",
      namespace: "checkout",
      name: "checkout-api",
    });
  });

  it("survives a name with a slash in it", () => {
    const route = logsRoute("Pod", "kube-system", "weird/name");
    expect(parseLogsRoute(route)).toEqual({ kind: "Pod", namespace: "kube-system", name: "weird/name" });
  });

  it("refuses a bare route and the list route it is not", () => {
    expect(parseLogsRoute("/logs")).toBeNull();
    expect(parseLogsRoute("/logs/checkout")).toBeNull();
    expect(parseLogsRoute("/k/pods/checkout/api-7")).toBeNull();
  });
});

describe("Logs", () => {
  it("names the subject and counts PODS, not containers", async () => {
    draw();
    expect(await screen.findByText("prod-eu / checkout / checkout-api · 3 pods")).toBeTruthy();
  });

  it("says one pod in the singular", async () => {
    h.resolve.mockResolvedValue({
      status: "resolved",
      targets: [{ pod: "api-7", container: "api", label: "" }],
    });
    draw(logsRoute("Pod", "checkout", "api-7"));
    expect(await screen.findByText("prod-eu / checkout / api-7 · 1 pod")).toBeTruthy();
  });

  it("draws each line with its time, source, severity and message", async () => {
    const region = await (draw(), body());
    push(...LINES);
    expect(rendered(region)).toEqual([
      // The message is the line as it was written, level word and all. A log
      // viewer that edits the text out of a line breaks the one thing a reader
      // does with it — compare it against what they grepped for elsewhere.
      "14:07:41.208|api-7 · api|info|info starting checkout-api build=4f2a1c",
      "14:07:42.100|api-7 · otel-sidecar|warning|warn exporter queue is full",
      "14:07:43.900|api-8 · api|danger|error pool timeout waited=30.0s in_use=5",
      "14:07:44.010|api-9 · api||GET /healthz 200 1ms",
    ]);
  });

  it("names the source of a single-target stream, which arrives unlabelled", async () => {
    // `resolveLogSubject` labels a line only when more than one target is in
    // scope — one pod, one container, no prefix. The column still has to say
    // which pod, or the design's source gutter is blank for every ordinary
    // single-container workload.
    h.resolve.mockResolvedValue({
      status: "resolved",
      targets: [{ pod: "api-7", container: "api", label: "" }],
    });
    const region = await (draw(logsRoute("Pod", "checkout", "api-7")), body());
    push({ source: "", text: "a line with no timestamp on it" });
    expect(rendered(region)).toEqual(["|api-7 · api||a line with no timestamp on it"]);
  });

  it("filters on the message and on the severity word, either case", async () => {
    const region = await (draw(), body());
    push(...LINES);
    const field = within(screen.getByRole("search", { name: /filter lines/i })).getByRole("searchbox");

    await userEvent.type(field, "POOL");
    expect(rendered(region).map((r) => r.split("|")[3])).toEqual([
      "error pool timeout waited=30.0s in_use=5",
    ]);

    await userEvent.clear(field);
    await userEvent.type(field, "warning");
    expect(rendered(region).map((r) => r.split("|")[3])).toEqual(["warn exporter queue is full"]);
  });

  it("filters by container", async () => {
    const region = await (draw(), body());
    push(...LINES);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /container/i }), "otel-sidecar");
    expect(rendered(region).map((r) => r.split("|")[3])).toEqual(["warn exporter queue is full"]);
  });

  it("wires the since select to what the stream is asked to tail", async () => {
    draw();
    await screen.findByRole("log", { name: /logs/i });
    expect(lastOptions().sinceSeconds).toBe(300);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /since/i }), "1h");
    await waitFor(() => expect(lastOptions().sinceSeconds).toBe(3600));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /since/i }), "all");
    await waitFor(() => expect(lastOptions().sinceSeconds).toBeUndefined());
  });

  it("asks for timestamps, because the design gives the time its own column", async () => {
    draw();
    await screen.findByRole("log", { name: /logs/i });
    expect(lastOptions().timestamps).toBe(true);
  });

  describe("the three states the design leaves out", () => {
    it("says nothing has been logged yet, naming the window that decides it", async () => {
      const region = await (draw(), body());
      expect(within(region).getByText(/nothing has been logged yet/i)).toBeTruthy();
      expect(within(region).getByText(/last 5m/i)).toBeTruthy();
    });

    it("says nothing MATCHES, which is a different sentence", async () => {
      const region = await (draw(), body());
      push(...LINES);
      const field = within(screen.getByRole("search", { name: /filter lines/i })).getByRole("searchbox");
      await userEvent.type(field, "zzz");

      expect(within(region).queryByText(/nothing has been logged yet/i)).toBeNull();
      expect(within(region).getByText(/no lines match/i)).toBeTruthy();
    });

    it("clears the filter from the state that reports it", async () => {
      const region = await (draw(), body());
      push(...LINES);
      const field = within(screen.getByRole("search", { name: /filter lines/i })).getByRole("searchbox");
      await userEvent.type(field, "zzz");
      await userEvent.click(within(region).getByRole("button", { name: /clear the filter/i }));
      expect(rendered(region)).toHaveLength(LINES.length);
    });

    it("reads a stream that could not start as friendly copy, not a raw error", async () => {
      h.state.status = "error";
      h.state.error = describeError("start_log_stream failed: request timeout");
      const region = await (draw(), body());
      const alert = within(region).getByRole("alert");
      expect(within(alert).getByText(/didn't respond in time/i)).toBeTruthy();
      // The original is still reachable, but only folded away behind
      // `RawError` — never as the sentence the reader is handed.
      expect(alert.querySelector("[data-slot=detail]")?.textContent).not.toContain(
        "start_log_stream failed",
      );
      expect(alert.querySelector("details")?.textContent).toContain("start_log_stream failed");
    });
  });

  describe("the subject", () => {
    it("says a workload has no pods rather than opening an empty stream", async () => {
      h.resolve.mockResolvedValue({
        status: "empty",
        detail: "Deployment/checkout-api has no pods to follow.",
      });
      draw();
      expect(await screen.findByText(/has no pods to follow/i)).toBeTruthy();
      expect(h.seen).toHaveLength(0);
    });

    it("reads a failed lookup through describeError", async () => {
      h.resolve.mockResolvedValue({
        status: "error",
        error: describeError("listing pods: request timeout"),
      });
      draw();
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText(/didn't respond in time/i)).toBeTruthy();
    });
  });

  describe("stick to bottom", () => {
    /**
     * jsdom does no layout, so the viewport's geometry has to be declared. The
     * heights are real numbers the component reads; `scrollTop` gets a backing
     * field so the component's own writes to it are observable — which is the
     * whole property under test.
     */
    function measurable(el: HTMLElement, rows: () => number) {
      let top = 0;
      Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 100 });
      Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => rows() * 20 });
      Object.defineProperty(el, "scrollTop", {
        configurable: true,
        get: () => top,
        set: (v: number) => {
          top = v;
        },
      });
      return {
        get top() {
          return top;
        },
        to(v: number) {
          top = v;
          fireEvent.scroll(el);
        },
      };
    }

    const many = (n: number, from = 0) =>
      Array.from({ length: n }, (_, i) =>
        line("api-7/api", "14:07:41.208000000", `line ${from + i}`),
      );

    it("pins the newest line while the reader is at the bottom", async () => {
      const region = await (draw(), body());
      const view = measurable(region, () => h.state.lines.length);

      push(...many(20));
      expect(view.top).toBe(400);

      push(...many(5, 20));
      expect(view.top).toBe(500);
    });

    it("does NOT yank a reader who has scrolled up", async () => {
      const region = await (draw(), body());
      const view = measurable(region, () => h.state.lines.length);
      push(...many(20));

      view.to(0);
      push(...many(5, 20));
      expect(view.top).toBe(0);

      // Back to the bottom — 25 rows of 20px in a 100px viewport — and
      // following resumes without a control to press.
      view.to(400);
      push(...many(5, 25));
      expect(view.top).toBe(600);
    });
  });

  describe("the window over a long buffer", () => {
    /**
     * `computeLogWindow` needs a measured row height before it will window
     * anything, and jsdom measures nothing. Only `.logline` is given a height,
     * so the measurement path under test is the real one — the screen finds
     * the first row itself.
     */
    function measurableRows() {
      const proto = window.HTMLElement.prototype;
      const original = proto.getBoundingClientRect;
      proto.getBoundingClientRect = function (this: HTMLElement) {
        if (this.classList.contains("logline")) return { height: 20 } as DOMRect;
        return original.call(this);
      };
      return () => {
        proto.getBoundingClientRect = original;
      };
    }

    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => line("api-7/api", "14:07:41.208000000", `line ${i}`));

    it("draws only the slice on screen, and reserves the rest", async () => {
      const restore = measurableRows();
      try {
        const region = await (draw(), body());
        Object.defineProperty(region, "clientHeight", { configurable: true, get: () => 100 });
        push(...many(300));

        const drawn = region.querySelectorAll(".logline");
        expect(drawn.length).toBeGreaterThan(0);
        expect(drawn.length).toBeLessThan(300);
        // The spacer that keeps the scrollbar honest about the 300 lines.
        const pads = Array.from(region.querySelectorAll("[aria-hidden=true]"));
        expect(pads.some((p) => (p as HTMLElement).style.height !== "")).toBe(true);
      } finally {
        restore();
      }
    });

    it("draws everything once lines wrap, because a wrapped row has no fixed height", async () => {
      const restore = measurableRows();
      try {
        const region = await (draw(), body());
        Object.defineProperty(region, "clientHeight", { configurable: true, get: () => 100 });
        push(...many(300));
        await userEvent.click(screen.getByRole("button", { name: "Wrap" }));
        expect(region.querySelectorAll(".logline")).toHaveLength(300);
      } finally {
        restore();
      }
    });
  });

  describe("the pause toggle", () => {
    it("reads Pause while following and Follow while paused", async () => {
      draw();
      await screen.findByRole("log", { name: /logs/i });
      await userEvent.click(screen.getByRole("button", { name: "Pause" }));
      expect(screen.getByRole("button", { name: "Follow" })).toBeTruthy();
    });

    it("says how many lines arrived while the view was held", async () => {
      draw();
      await screen.findByRole("log", { name: /logs/i });
      await userEvent.click(screen.getByRole("button", { name: "Pause" }));
      act(() => {
        h.state.pending = 12;
        notify();
      });
      expect(screen.getByText(/12 new lines/i)).toBeTruthy();
    });
  });

  describe("what the stream is doing", () => {
    it("says Following while it is live", async () => {
      draw();
      await screen.findByRole("log", { name: /logs/i });
      expect(within(screen.getByRole("status")).getByText("Following")).toBeTruthy();
    });

    it("says so when the connection is being retried", async () => {
      draw();
      await screen.findByRole("log", { name: /logs/i });
      act(() => {
        h.state.status = "reconnecting";
        notify();
      });
      expect(within(screen.getByRole("status")).getByText("Reconnecting")).toBeTruthy();
    });
  });

  it("says how much of the buffer the ring has thrown away", async () => {
    const region = await (draw(), body());
    act(() => {
      h.state.lines = LINES;
      h.state.dropped = 1200;
      notify();
    });
    expect(within(region).getByText(/1 200 earlier lines/i)).toBeTruthy();
  });

  it("hands the stream to the console when asked about", async () => {
    draw();
    await screen.findByRole("log", { name: /logs/i });
    await userEvent.click(screen.getByRole("button", { name: /Summarise this stream/i }));
    await waitFor(() =>
      expect(asked).toEqual(["Summarise the last 500 log lines and group errors by cause"]),
    );
  });

  it("asks which logs rather than showing none, on a bare route", async () => {
    draw("/logs");
    expect(await screen.findByText(/pick a workload or a pod/i)).toBeTruthy();
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("says there is no cluster in focus rather than streaming from nowhere", async () => {
    resetContexts();
    setContexts([]);
    draw();
    expect(await screen.findByText(/no cluster in focus/i)).toBeTruthy();
    expect(h.resolve).not.toHaveBeenCalled();
  });
});
