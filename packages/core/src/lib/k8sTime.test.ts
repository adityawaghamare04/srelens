import { describe, it, expect } from "vitest";
import { ageFromTimestamp } from "./k8sTime";

const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("ageFromTimestamp", () => {
  it("formats seconds, minutes, hours, and days", () => {
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 30_000)).toBe("30s");
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 5 * 60_000)).toBe("5m");
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 3 * 3_600_000)).toBe("3h");
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 2 * 86_400_000)).toBe("2d");
  });

  it("returns a dash for missing or invalid input", () => {
    expect(ageFromTimestamp(undefined, NOW)).toBe("—");
    expect(ageFromTimestamp("not-a-date", NOW)).toBe("—");
  });
});
