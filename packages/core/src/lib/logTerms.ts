import type { LogLine } from "./logBuffer";
import type { HealthKind } from "./k8sHealth";

/**
 * The rail's recurring-term tally: what a log stream keeps saying, most
 * frequent first, each toned by how bad the lines behind it are.
 *
 * ## The normalisation rule, and why
 *
 * Every log line is unique once you look at its whole text — a timestamp, a
 * trace id, a duration, a request path all vary line to line even when the
 * *event* repeats. Tallying whole lines therefore yields a list of ones,
 * which is the failure mode this file exists to avoid.
 *
 * The first cut — mask anything shaped like data — is easy and structural: a
 * bare token that opens with a digit (`30.0s`, `503`, `18`, `84ms`) is always
 * a value, never a label, so it always ends the run.
 *
 * The hard cut is `key=value` pairs, and it cannot be structural.
 * `status=503` and `duration=30011ms` are shaped identically — a word, an
 * `=`, and something that starts with a digit — yet one is the rail's
 * strongest signal and the other is noise. Nothing about either token's
 * *shape* tells them apart. What does is how each behaves **across the
 * buffer**: `status=503` is the literal same six characters on every failed
 * request in this window, while `duration=` and `trace_id=` carry a
 * different value practically every time. That is cardinality, and it is the
 * one thing a shape-based regex cannot see but a pass over the buffer can.
 *
 * So the rule is: **a `key=value` token is trusted, and used whole as the
 * term, once it has been seen recurring — the exact same literal pair,
 * twice or more — anywhere in the buffer.** A `key=value` token that has
 * never repeated is treated the same as a bare number: it ends the run
 * without being included, because a value seen once carries no more meaning
 * here than a raw timestamp would. This is the same recurrence bar
 * ({@link MIN_RECURRENCES}) the tally itself enforces on whole terms —
 * applied one level down, to the tokens that might become one.
 *
 * A trusted `key=value` pair, wherever it sits in the line, wins outright
 * and becomes the term by itself — `request failed status=503 …` yields
 * `status=503`, not `request failed`, because the code is the more specific,
 * more diagnostic fact, and there is no principled way to keep both without
 * the rail scrolling. When no token in the line has earned that trust, the
 * fallback is the message's own leading words: the run of bare, non-numeric
 * tokens from the start, capped at two, which is how `pool timeout`, `pool
 * saturated` and `liveness deadline` are recovered from lines that carry no
 * repeatable `key=value` pair at all. A line that opens with a bare number
 * or an untrusted pair, and has no bare words before it, contributes nothing
 * — there is nothing stable to say about it.
 *
 * A log line commonly opens with its own level word (`ERROR pool timeout …`);
 * that word is structural, not the message, so a single leading severity
 * word is skipped rather than counted toward the two-word cap.
 *
 * This recovers three of the design's four named terms unconditionally
 * (`pool timeout`, `pool saturated`, `liveness deadline` — none of their
 * lines carry a `key=value` pair that recurs) and the fourth,
 * `status=503`, precisely because it is the one that does.
 *
 * ## Tone
 *
 * "Every status word and tone comes from core" (plan constraint) — so this
 * file does not invent a colour vocabulary. It reuses `HealthKind`
 * ({@link "./k8sHealth"}), core's one canonical severity vocabulary, rather
 * than adding a sibling. `LogLine` (`./logBuffer`) carries no parsed level
 * field, so the level is read off the raw text the same way classic already
 * does it (`lineLevel` in `apps/desktop/src/components/LogsView.tsx`, a
 * whole-string word search) — reprojected onto `HealthKind` instead of
 * classic's own local union, so this file is not a second copy of that
 * table, just a second consumer of the one scan. If `LogLine` grows a real
 * parsed level later, this is the one place that needs to change.
 *
 * A term's lines are not all the same severity — the same `status=503`
 * fires from a request logged at `warn` on retry and `error` on final
 * failure. **Worst wins**: the same rule the cluster overview already uses
 * when one fact is read more than once (see the note on `worst()` beside
 * `StatusVerdict` in `k8sStatus.ts`) — a term is exactly as alarming as its
 * single worst occurrence, because that is the line the reader most needs
 * the colour to point at.
 */
const TERM_WORDS = 2;

/**
 * A tally is only useful once something has actually recurred; a term (or a
 * `key=value` token) seen once is, by definition, not recurring, and
 * showing it turns the rail back into the wall-of-noise it exists to
 * summarise. Two occurrences is the lowest bar that still means "recurred".
 */
const MIN_RECURRENCES = 2;

/** How many rows the rail shows by default — enough breadth, not a scroll. */
const DEFAULT_CAP = 8;

/** A leading digit means the token is a number, a duration, or an id. */
const OPENS_WITH_DIGIT = /^-?\d/;

/** A bare severity word, structural rather than message content when leading. */
const SEVERITY_WORD = /^(?:error|fatal|panic|warn|warning|info|debug|trace)$/i;

/** Words classic already keys the danger tone off, verbatim. */
const DANGER_WORD = /\b(?:error|fatal|panic)\b/i;
/** ditto, the warning tone. */
const WARNING_WORD = /\bwarn(?:ing)?\b/i;
/** ditto, the info tone. */
const INFO_WORD = /\binfo\b/i;
/**
 * Recognised but untoned: `logLineHealth` has never coloured these, and this
 * scan does not start now — see {@link logLineLevel}'s doc for why they are
 * still worth returning to a caller that wants the level column's word.
 */
const DEBUG_TRACE_WORD = /\b(?:debug|trace)\b/i;

function isBareNumeric(token: string): boolean {
  return OPENS_WITH_DIGIT.test(token);
}

/** Splits a `key=value` token, or returns `null` for anything else. */
function splitKeyValue(token: string): { key: string; value: string } | null {
  const eq = token.indexOf("=");
  if (eq <= 0) return null;
  return { key: token.slice(0, eq), value: token.slice(eq + 1) };
}

/** Whitespace-split tokens, trailing sentence punctuation stripped. */
function tokenize(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .map((raw) => raw.replace(/[.,;:!?]+$/, ""))
    .filter((t) => t.length > 0);
}

/**
 * One line's candidate term: the first `key=value` token that has recurred
 * (trusted) anywhere in the buffer, or else the leading run of bare words,
 * capped at {@link TERM_WORDS}. See the module doc for the reasoning.
 */
function lineTerm(tokens: readonly string[], kvFrequency: ReadonlyMap<string, number>): string | null {
  const bareRun: string[] = [];
  for (const token of tokens) {
    const kv = splitKeyValue(token);
    if (kv !== null) {
      if ((kvFrequency.get(token) ?? 0) >= MIN_RECURRENCES) return token;
      break; // an unrepeated pair is where the varying detail starts
    }
    if (isBareNumeric(token)) break;
    if (bareRun.length === 0 && SEVERITY_WORD.test(token)) continue; // a leading level word, not content
    bareRun.push(token);
  }
  return bareRun.length > 0 ? bareRun.slice(0, TERM_WORDS).join(" ") : null;
}

/**
 * A raw log line's level word, exactly as the line spelled it — `"error"`,
 * `"WARNING"`, `"warn"`, `"info"`, `"debug"`, `"trace"` — or `undefined` when
 * the line carries none. The ONE place in srelens that scans a line for this;
 * `logLineHealth` below and the Logs screen's level column both read it
 * through here rather than running their own regex over the same text.
 *
 * This is a **text-scan heuristic, not a parsed field** — say so plainly,
 * because the stream gives us nothing structured to read instead. `LogLine`
 * (`./logBuffer`) carries only `{ source, text }`; there is no level column
 * anywhere between the backend and here. So this scans the whole raw line,
 * case-insensitively, for a recognised level word — the same vocabulary
 * classic's `lineLevel` already keys off
 * (`apps/desktop/src/components/LogsView.tsx:61`), plus `debug`/`trace`,
 * which classic never needed a colour for but a level column still has room
 * to print. If `LogLine` ever grows a real parsed level, THIS is the one
 * function to repoint at it.
 *
 * Checked worst-first (danger family, then warning, then info, then
 * debug/trace) so a line that somehow carries more than one recognised word
 * — "escalated to error after a warn" — returns the word that matters more,
 * not whichever regex happened to match first. This is the same precedence
 * `logLineHealth` checked before this function existed; it is preserved here
 * so factoring the scan out changes nothing about which word wins.
 *
 * **Returns the literal word, not `logLineHealth`'s tone name** — the level
 * column wants "error", and printing `logLineHealth`'s "danger" there was
 * the bug this function exists to fix. One caveat: `panic` is danger-family
 * here (as it always has been) but is not a key the kit's `LEVEL_TONE`
 * (`packages/ui-kit/src/LogLine.tsx`) recognises, so a line whose only level
 * word is `panic` will still print "panic" in the column but the kit tones
 * it `muted` rather than `sev` — narrowing this function to drop `panic`
 * would silently change what a real panic line reports, so the mismatch is
 * left for the kit to close instead.
 */
export function logLineLevel(text: string): string | undefined {
  return (
    DANGER_WORD.exec(text)?.[0] ??
    WARNING_WORD.exec(text)?.[0] ??
    INFO_WORD.exec(text)?.[0] ??
    DEBUG_TRACE_WORD.exec(text)?.[0] ??
    undefined
  );
}

/** {@link logLineLevel}'s recognised words, worst-first, mapped to their tone. */
const LEVEL_HEALTH: Record<string, HealthKind> = {
  error: "danger",
  fatal: "danger",
  panic: "danger",
  warn: "warning",
  warning: "warning",
  info: "info",
};

/**
 * A raw log line's severity — the ONE place in srelens that decides this, on
 * core's canonical `HealthKind` vocabulary (`./k8sHealth`).
 *
 * Derived from {@link logLineLevel} rather than scanning the text itself:
 * there is exactly one rule for "what level word does this line carry", and
 * this is a second consumer of it, not a second copy of the regexes. A level
 * `logLineLevel` recognises but does not tone — `debug`, `trace` — reads
 * `neutral` here, same as no level word at all; every other caller (the term
 * tally below, and the Logs screen's `LogLine` level prop and level filter)
 * goes through here rather than re-deriving severity on its own, which is
 * exactly what the plan's "every status word and tone comes from core"
 * constraint is guarding against: a second hand-paired label/tone table,
 * invented at the call site.
 */
export function logLineHealth(text: string): HealthKind {
  const level = logLineLevel(text);
  if (level === undefined) return "neutral";
  return LEVEL_HEALTH[level.toLowerCase()] ?? "neutral";
}

const HEALTH_RANK: Record<HealthKind, number> = {
  danger: 4,
  warning: 3,
  info: 2,
  success: 1,
  neutral: 0,
};

/** One recurring term the rail can show: its count, and its worst tone. */
export interface LogTerm {
  readonly term: string;
  readonly count: number;
  readonly tone: HealthKind;
}

/**
 * Tally the recurring terms across a buffer's lines, most frequent first,
 * dropping anything that only occurred once and capping the result so the
 * rail never has to scroll through dozens of rows.
 *
 * Tallies over `line.text` only — `line.source` (the pod/container tag) plays
 * no part, so the same message from three different pods still counts as one
 * term.
 */
export function tallyLogTerms(
  lines: readonly LogLine[],
  options?: { readonly cap?: number },
): LogTerm[] {
  const cap = options?.cap ?? DEFAULT_CAP;
  const tokenized = lines.map((l) => tokenize(l.text));

  // Pass 1: how many times has each literal key=value token recurred, over
  // the WHOLE buffer? This is the cardinality signal the rule is built on.
  const kvFrequency = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const token of tokens) {
      if (splitKeyValue(token) !== null) {
        kvFrequency.set(token, (kvFrequency.get(token) ?? 0) + 1);
      }
    }
  }

  // Pass 2: pick each line's term with that frequency table in hand, and
  // track how many lines chose it and the worst tone among them.
  const counts = new Map<string, number>();
  const tones = new Map<string, HealthKind>();
  for (let i = 0; i < lines.length; i += 1) {
    const term = lineTerm(tokenized[i], kvFrequency);
    if (term === null) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
    const health = logLineHealth(lines[i].text);
    const worst = tones.get(term);
    if (worst === undefined || HEALTH_RANK[health] > HEALTH_RANK[worst]) {
      tones.set(term, health);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= MIN_RECURRENCES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([term, count]) => ({ term, count, tone: tones.get(term) ?? "neutral" }));
}
