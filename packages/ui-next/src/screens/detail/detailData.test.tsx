import { describe, it, expect } from "vitest";
import type { EventSummary } from "@srelens/core";
import { EVENT_COLUMNS } from "./detailData";

/**
 * `EVENT_COLUMNS`' Type cell used to pair a tone with `e.type` by hand — one
 * of the two hand-rolled event-tone rules `eventVerdict` replaces (the other
 * is classic's). This asserts the cell now reads its tone off `eventVerdict`,
 * not off a literal comparison against `"Warning"` sitting in this file.
 */
const event = (type: string): EventSummary => ({
  name: "web-1.abc",
  type,
  reason: "BackOff",
  object: "Pod/web-1",
  message: "container crashed",
  age: "5m",
  count: 1,
});

function typeCellTone(type: string): unknown {
  const typeColumn = EVENT_COLUMNS.find((c) => c.key === "type");
  const cell = typeColumn?.render?.(event(type)) as { props: { tone: unknown } };
  return cell.props.tone;
}

describe("EVENT_COLUMNS — the Type cell's tone comes from eventVerdict", () => {
  it("tones a Warning event danger (sev) — moved from the old warn tone", () => {
    // This is the rendered change eventVerdict brings: the design's rule
    // (§B.2) is Warning -> sev, and the hand-paired table this replaces used
    // the warning tone instead.
    expect(typeCellTone("Warning")).toBe("sev");
  });

  it("tones a Normal event muted", () => {
    expect(typeCellTone("Normal")).toBe("muted");
  });

  it("tones an unrecognised event type muted, not alarming", () => {
    expect(typeCellTone("Something")).toBe("muted");
  });
});
