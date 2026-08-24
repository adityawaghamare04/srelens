import { describe, it, expect } from "vitest";
import { tallyLogTerms, logLineHealth, logLineLevel } from "./logTerms";
import type { LogLine } from "./logBuffer";

const line = (text: string, source = ""): LogLine => ({ source, text });

describe("tallyLogTerms", () => {
  it("recovers 'pool timeout' from the design's sample line and its siblings", () => {
    // Verbatim message from docs/superpowers/specs/mock-full-design.md §15,
    // repeated with a different wait, pool size, in-use count and route each
    // time — the parts a real pool-timeout error always varies — and an
    // "error" level word out front, as a real raw line would carry.
    const lines = [
      line(
        "error pool timeout waited=30.0s pool_size=5 in_use=5 route=POST /v2/checkout/authorize",
      ),
      line("error pool timeout waited=12.4s pool_size=5 in_use=5 route=POST /v2/cart/add"),
      line("error pool timeout waited=8.9s pool_size=8 in_use=8 route=GET /v2/catalog/search"),
    ];
    expect(tallyLogTerms(lines)).toEqual([{ term: "pool timeout", count: 3, tone: "danger" }]);
  });

  it("recovers 'status=503' — a key=value pair — because it recurs identically, not because of its shape", () => {
    // Same shape as the untrusted pairs beside it (`trace_id=…`,
    // `duration=…ms`) — a word, '=', digits. What tells them apart is
    // cardinality: status=503 is the literal same token every time, the
    // other two are practically never repeated. Only cardinality can see
    // that; no per-token regex can.
    const lines = [
      line("error request failed status=503 trace_id=a1b2c3 duration=30011ms"),
      line("error request failed status=503 trace_id=f9e8d7 duration=15230ms"),
      line("error request failed status=503 trace_id=001122 duration=42009ms"),
    ];
    expect(tallyLogTerms(lines)).toEqual([{ term: "status=503", count: 3, tone: "danger" }]);
  });

  it("recovers 'pool saturated', warn-toned, from its own siblings", () => {
    const lines = [
      line("warn pool saturated, queueing request depth=18"),
      line("warn pool saturated, queueing request depth=31"),
      line("warn pool saturated, queueing request depth=9"),
    ];
    expect(tallyLogTerms(lines)).toEqual([{ term: "pool saturated", count: 3, tone: "warning" }]);
  });

  it("recovers 'liveness deadline', warn-toned, from its own siblings", () => {
    const lines = [
      line("warn liveness deadline exceeded, terminating"),
      line("warn liveness deadline exceeded, terminating"),
    ];
    expect(tallyLogTerms(lines)).toEqual([{ term: "liveness deadline", count: 2, tone: "warning" }]);
  });

  it("a key=value pair shaped exactly like a trusted one, but that never repeats, still falls through to the headline", () => {
    // Same key, same shape as the status=503 case above — the only
    // difference is that this value is different every time, which is
    // exactly what a real build id would do.
    const lines = [
      line("starting build=cafeb0b1 now"),
      line("starting build=deadbeef now"),
      line("starting build=0ff1ce00 now"),
    ];
    expect(tallyLogTerms(lines)).toEqual([{ term: "starting", count: 3, tone: "neutral" }]);
  });

  it("worst tone wins when the same term appears at more than one severity", () => {
    const lines = [
      line("warn pool saturated, queueing request depth=18"),
      line("error pool saturated, queueing request depth=41"),
    ];
    expect(tallyLogTerms(lines)).toEqual([{ term: "pool saturated", count: 2, tone: "danger" }]);
  });

  it("counts most frequent first", () => {
    const lines = [
      line("warn pool saturated, queueing request depth=18"),
      line("warn pool saturated, queueing request depth=41"),
      line("error pool timeout waited=30.0s pool_size=5 in_use=5 route=POST /a"),
      line("error pool timeout waited=12.4s pool_size=5 in_use=5 route=POST /b"),
      line("error pool timeout waited=8.9s pool_size=8 in_use=8 route=GET /c"),
      line("error pool timeout waited=2.1s pool_size=5 in_use=4 route=GET /d"),
      line("error pool timeout waited=44.0s pool_size=6 in_use=6 route=POST /e"),
    ];
    expect(tallyLogTerms(lines)).toEqual([
      { term: "pool timeout", count: 5, tone: "danger" },
      { term: "pool saturated", count: 2, tone: "warning" },
    ]);
  });

  it("a buffer of unique, unrelated lines yields nothing rather than a list of ones", () => {
    const lines = [
      line("info starting checkout-api build=4f2a1c pool_size=5 pool_timeout=30s"),
      line("info shutting down http server, draining 18 in-flight requests"),
      line("GET /healthz 200 1ms"),
      line("warn readiness probe failing, 3 consecutive 503s"),
    ];
    expect(tallyLogTerms(lines)).toEqual([]);
  });

  it("an empty buffer yields nothing", () => {
    expect(tallyLogTerms([])).toEqual([]);
  });

  it("a single occurrence does not earn a row, but a second one does", () => {
    const lines = [line("error pool timeout waited=30.0s pool_size=5 in_use=5 route=POST /x")];
    expect(tallyLogTerms(lines)).toEqual([]);
    lines.push(line("error pool timeout waited=1.0s pool_size=5 in_use=5 route=GET /y"));
    expect(tallyLogTerms(lines)).toEqual([{ term: "pool timeout", count: 2, tone: "danger" }]);
  });

  it("caps the number of terms reported", () => {
    const lines: LogLine[] = [];
    for (let i = 0; i < 12; i += 1) {
      // 12 distinct two-word leading phrases, each recurring 3 times, so
      // every one clears the recurrence threshold and only the cap decides.
      lines.push(line(`term${i} alpha count=${i}`));
      lines.push(line(`term${i} alpha count=${i + 100}`));
      lines.push(line(`term${i} alpha count=${i + 200}`));
    }
    const result = tallyLogTerms(lines);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it("honours a caller-supplied cap", () => {
    const lines: LogLine[] = [];
    for (let i = 0; i < 5; i += 1) {
      lines.push(line(`term${i} alpha count=${i}`));
      lines.push(line(`term${i} alpha count=${i + 100}`));
    }
    expect(tallyLogTerms(lines, { cap: 2 })).toHaveLength(2);
  });

  it("ignores the source tag entirely — tallying is over the message, not the tag", () => {
    const lines = [
      line("error pool timeout waited=30.0s pool_size=5 in_use=5 route=POST /x", "pod-a/api"),
      line("error pool timeout waited=1.0s pool_size=5 in_use=5 route=GET /y", "pod-b/api"),
    ];
    expect(tallyLogTerms(lines)).toEqual([{ term: "pool timeout", count: 2, tone: "danger" }]);
  });

  it("a line that opens with a variable token contributes nothing", () => {
    const lines = [line("503 errors spiking"), line("503 errors spiking again")];
    expect(tallyLogTerms(lines)).toEqual([]);
  });

  it("a leading level word is structural and does not itself count toward the two-word cap", () => {
    const lines = [line("error pool timeout waited=30.0s"), line("warn pool timeout waited=9.0s")];
    // Different level words, same headline: still "pool timeout", not
    // "error pool" / "warn pool" — and the tone is the worst of the two.
    expect(tallyLogTerms(lines)).toEqual([{ term: "pool timeout", count: 2, tone: "danger" }]);
  });
});

describe("logLineHealth", () => {
  // The public surface: this is now the one place that decides a raw log
  // line's severity, for both the term tally above and any other consumer
  // (the Logs screen's LogLine level prop and its level filter). Tested in
  // its own right, not just indirectly through tallyLogTerms.

  it("reads 'error', 'fatal' and 'panic' as danger", () => {
    expect(logLineHealth("connection error: pool exhausted")).toBe("danger");
    expect(logLineHealth("fatal: liveness deadline exceeded, terminating")).toBe("danger");
    expect(logLineHealth("panic: runtime error: index out of range")).toBe("danger");
  });

  it("reads 'warn' and 'warning' as warning", () => {
    expect(logLineHealth("warn pool saturated, queueing request")).toBe("warning");
    expect(logLineHealth("WARNING: certificate expires in 6 days")).toBe("warning");
  });

  it("reads 'info' as info", () => {
    expect(logLineHealth("info starting checkout-api build=4f2a1c")).toBe("info");
  });

  it("reads anything with no recognised level word as neutral", () => {
    expect(logLineHealth("GET /healthz 200 1ms")).toBe("neutral");
    expect(logLineHealth("")).toBe("neutral");
  });

  it("is case-insensitive and matches anywhere in the line, not only a leading word", () => {
    expect(logLineHealth("14:07:41.902 ERROR pool timeout waited=30.0s")).toBe("danger");
    expect(logLineHealth("request failed status=503, see Warn budget below")).toBe("warning");
  });

  it("prefers danger over warning or info when a line somehow carries more than one", () => {
    // Not expected in practice, but the precedence should be principled
    // (worst word wins) rather than "whichever regex runs first" by luck.
    expect(logLineHealth("warn: escalated to error after 3 retries")).toBe("danger");
  });

  it("does not match a level word as a substring of an unrelated word", () => {
    // 'informant' contains 'info', 'forewarned' contains 'warn' — neither
    // should trip the level scan; the classic-derived word-boundary regexes
    // guard exactly this.
    expect(logLineHealth("the informant forewarned the team")).toBe("neutral");
  });
});

describe("logLineLevel", () => {
  // The ONE scan that decides what level word a raw log line carries — spelt
  // as the line itself spells it, for the level column. `logLineHealth`
  // above is now a consumer of this, not a second regex over the same text.

  it("returns the level word exactly as the line spelled it, not a tone name", () => {
    expect(logLineLevel("connection error: pool exhausted")).toBe("error");
    expect(logLineLevel("14:07:41.902 ERROR pool timeout waited=30.0s")).toBe("ERROR");
    expect(logLineLevel("WARNING: certificate expires in 6 days")).toBe("WARNING");
    expect(logLineLevel("warn pool saturated, queueing request")).toBe("warn");
    expect(logLineLevel("info starting checkout-api build=4f2a1c")).toBe("info");
  });

  it("recognises debug and trace, which carry no tone of their own", () => {
    expect(logLineLevel("debug cache miss for key=42")).toBe("debug");
    expect(logLineLevel("trace entering handler")).toBe("trace");
  });

  it("returns undefined when the line carries no recognised level word", () => {
    expect(logLineLevel("GET /healthz 200 1ms")).toBeUndefined();
    expect(logLineLevel("")).toBeUndefined();
  });

  it("does not match a level word as a substring of an unrelated word", () => {
    expect(logLineLevel("the informant forewarned the team")).toBeUndefined();
  });

  it("prefers the worst word when a line carries more than one, same as logLineHealth", () => {
    // 'error' (danger family) beats 'warn' (warning family) beats 'info',
    // exactly the precedence logLineHealth checks — because logLineHealth is
    // now derived from this scan, not a second one.
    expect(logLineLevel("warn: escalated to error after 3 retries")).toBe("error");
  });

  it("logLineHealth is derived from this scan, not a second regex over the same text", () => {
    // Every level word this function can return either maps to the same
    // HealthKind logLineHealth already returned for it, or — for a word this
    // function recognises but logLineHealth never toned (debug, trace) —
    // logLineHealth still reads neutral, unchanged from before the refactor.
    const samples = [
      "connection error: pool exhausted",
      "fatal: liveness deadline exceeded, terminating",
      "panic: runtime error: index out of range",
      "warn pool saturated, queueing request",
      "WARNING: certificate expires in 6 days",
      "info starting checkout-api build=4f2a1c",
      "debug cache miss for key=42",
      "trace entering handler",
      "GET /healthz 200 1ms",
    ];
    for (const text of samples) {
      const level = logLineLevel(text);
      const health = logLineHealth(text);
      if (level === undefined) {
        expect(health).toBe("neutral");
      } else if (/^(?:error|fatal|panic)$/i.test(level)) {
        expect(health).toBe("danger");
      } else if (/^warn(?:ing)?$/i.test(level)) {
        expect(health).toBe("warning");
      } else if (/^info$/i.test(level)) {
        expect(health).toBe("info");
      } else {
        // debug / trace: recognised as a level, but not a tone.
        expect(health).toBe("neutral");
      }
    }
  });
});
