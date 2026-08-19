import { describe, it, expect } from "vitest";
import { printerColumnKeys, printerSortValue } from "./crds";

const col = (name: string, jsonPath: string, type = "string") => ({ name, jsonPath, type });

describe("printerColumnKeys", () => {
  it("identifies a column by its definition, not its position", () => {
    // An operator upgrade that prepends a column must not change the key of the
    // ones already there: those keys persist hidden/sort/filter state.
    const before = printerColumnKeys([col("Ready", ".status.ready"), col("Version", ".spec.version")]);
    const after = printerColumnKeys([
      col("Phase", ".status.phase"),
      col("Ready", ".status.ready"),
      col("Version", ".spec.version"),
    ]);
    expect(after.slice(1)).toEqual(before);
  });

  it("distinguishes columns sharing a heading but reading different fields", () => {
    const keys = printerColumnKeys([col("Status", ".status.a"), col("Status", ".status.b")]);
    expect(new Set(keys).size).toBe(2);
  });

  it("still disambiguates genuinely identical definitions", () => {
    const keys = printerColumnKeys([col("Ready", ".status.ready"), col("Ready", ".status.ready")]);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("printerSortValue", () => {
  it("orders signed and decimal numbers numerically", () => {
    // The table's collator gets both of these backwards on the rendered text.
    expect(printerSortValue("integer", "-10")).toBeLessThan(printerSortValue("integer", "-2") as number);
    expect(printerSortValue("number", "1.15")).toBeLessThan(printerSortValue("number", "1.2") as number);
    expect(printerSortValue("integer", "2")).toBeLessThan(printerSortValue("integer", "10") as number);
  });

  it("orders dates by duration, not by the text of the age", () => {
    // "10d" vs "2h": text collation puts 10d first by leading digit.
    expect(printerSortValue("date", "2h")).toBeLessThan(printerSortValue("date", "10d") as number);
    expect(printerSortValue("date", "300d")).toBeLessThan(printerSortValue("date", "1y") as number);
  });

  it("groups unset and unparseable values below real ones", () => {
    expect(printerSortValue("integer", "")).toBe(Number.NEGATIVE_INFINITY);
    expect(printerSortValue("number", "n/a")).toBe(Number.NEGATIVE_INFINITY);
    expect(printerSortValue("date", "-")).toBe(-1);
  });

  it("leaves string columns as text", () => {
    expect(printerSortValue("string", "GREEN")).toBe("GREEN");
  });
});
