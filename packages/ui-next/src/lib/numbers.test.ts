import { describe, it, expect } from "vitest";
import { groupNumber } from "./numbers";

describe("groupNumber", () => {
  it("leaves anything under a thousand alone", () => {
    expect(groupNumber(0)).toBe("0");
    expect(groupNumber(7)).toBe("7");
    expect(groupNumber(999)).toBe("999");
  });

  it("groups every three digits, from the right", () => {
    expect(groupNumber(1000)).toBe("1 000");
    expect(groupNumber(1200)).toBe("1 200");
    expect(groupNumber(12345)).toBe("12 345");
    expect(groupNumber(1234567)).toBe("1 234 567");
  });

  it("separates with a space, not a comma or a full stop", () => {
    // The whole reason this is not `toLocaleString`: the same buffer size
    // would read `1,200` for one reader and `1.200` for another, and the two
    // mean different numbers to the people who use them.
    const grouped = groupNumber(1234567);
    expect(grouped).not.toContain(",");
    expect(grouped).not.toContain(".");
    expect(grouped.split(" ")).toEqual(["1", "234", "567"]);
  });

  it("groups a negative number's digits without cutting into the sign", () => {
    // `-1200` alone proves nothing about the sign: its leading group is one
    // digit long, so the only place a separator can land is between the digits
    // whether or not the `\B` guard is there. The guard has something to stop
    // only when the leading group is exactly three digits — that is where a
    // word boundary sits immediately after the `-` and an unguarded lookahead
    // writes `- 120`.
    expect(groupNumber(-120)).toBe("-120");
    expect(groupNumber(-999)).toBe("-999");
    expect(groupNumber(-120000)).toBe("-120 000");
    expect(groupNumber(-1200)).toBe("-1 200");
    expect(groupNumber(-1234567)).toBe("-1 234 567");
  });
});
