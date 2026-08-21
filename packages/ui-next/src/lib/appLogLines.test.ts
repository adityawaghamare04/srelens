import { describe, it, expect } from "vitest";
import {
  LEVELS,
  MAX_RENDERED,
  filterLines,
  logLineLevel,
  parseAppLog,
  type Level,
} from "./appLogLines";

/** A line in the shape tauri-plugin-log writes. */
const line = (level: string, message: string, time = "09:12:03") =>
  `[2026-08-21][${time}][srelens::cluster][${level}] ${message}`;

describe("logLineLevel", () => {
  it("reads every level the logger emits", () => {
    for (const level of LEVELS) {
      expect(logLineLevel(line(level, "something happened"))).toBe(level);
    }
  });

  it("defaults to INFO for a line with no level bracket", () => {
    expect(logLineLevel("    at srelens::cluster::connect")).toBe("INFO");
    expect(logLineLevel("")).toBe("INFO");
    // A bracket that is not one of the five is not a level either.
    expect(logLineLevel("[2026-08-21][09:12:03][srelens][NOISE] hi")).toBe("INFO");
  });
});

describe("parseAppLog", () => {
  it("splits the timestamp, the level and the message apart", () => {
    const [entry] = parseAppLog(line("WARN", "context prod is unreachable"));
    expect(entry).toEqual({
      ts: "2026-08-21 09:12:03",
      level: "WARN",
      message: "context prod is unreachable",
      raw: line("WARN", "context prod is unreachable"),
    });
  });

  it("keeps a line the logger did not write, whole", () => {
    const [entry] = parseAppLog("    at srelens::cluster::connect");
    expect(entry).toEqual({
      ts: "",
      level: "INFO",
      message: "at srelens::cluster::connect",
      raw: "    at srelens::cluster::connect",
    });
  });

  it("drops blank lines and keeps the rest in order", () => {
    const parsed = parseAppLog(
      [line("INFO", "one"), "", line("ERROR", "two", "09:12:04"), ""].join("\n"),
    );
    expect(parsed.map((e) => e.message)).toEqual(["one", "two"]);
    expect(parsed.map((e) => e.level)).toEqual(["INFO", "ERROR"]);
  });

  it("is empty for an empty log", () => {
    expect(parseAppLog("")).toEqual([]);
  });
});

describe("filterLines", () => {
  const lines = parseAppLog(
    [
      line("INFO", "connected to prod"),
      line("ERROR", "RBAC denied for Pods", "09:12:04"),
      line("WARN", "slow response from prod", "09:12:05"),
    ].join("\n"),
  );

  it("keeps everything at level 'all' with no text", () => {
    expect(filterLines(lines, "", "all")).toHaveLength(3);
  });

  it("filters by level", () => {
    expect(filterLines(lines, "", "ERROR").map((e) => e.message)).toEqual([
      "RBAC denied for Pods",
    ]);
  });

  it("filters by text, case-insensitively", () => {
    expect(filterLines(lines, "RBAC", "all").map((e) => e.message)).toEqual([
      "RBAC denied for Pods",
    ]);
    expect(filterLines(lines, "rbac", "all").map((e) => e.message)).toEqual([
      "RBAC denied for Pods",
    ]);
  });

  it("applies text and level together", () => {
    expect(filterLines(lines, "prod", "WARN").map((e) => e.message)).toEqual([
      "slow response from prod",
    ]);
    expect(filterLines(lines, "prod", "ERROR")).toEqual([]);
  });

  it("keeps the newest MAX_RENDERED of a log that exceeds the cap", () => {
    const many = parseAppLog(
      Array.from({ length: MAX_RENDERED + 1 }, (_, i) => line("INFO", `entry ${i}`)).join("\n"),
    );
    const capped = filterLines(many, "", "all");
    expect(MAX_RENDERED).toBe(5000);
    expect(capped).toHaveLength(MAX_RENDERED);
    // The oldest is the one dropped, so the window ends at the newest line.
    expect(capped[0].message).toBe("entry 1");
    expect(capped[capped.length - 1].message).toBe(`entry ${MAX_RENDERED}`);
  });
});

describe("LEVELS", () => {
  it("is the logger's five, most severe first", () => {
    const expected: Level[] = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
    expect([...LEVELS]).toEqual(expected);
  });
});
