import { describe, it, expect } from "vitest";
import type { CrdRef } from "@srelens/core";
import { customColumns, customDescriptorFor } from "./custom";

const crd = (over: Partial<CrdRef> = {}): CrdRef => ({
  name: "widgets.example.com", group: "example.com", version: "v1", plural: "widgets",
  kind: "Widget", namespaced: true,
  printerColumns: [
    { name: "Phase", type: "string", jsonPath: ".status.phase" },
    { name: "Since", type: "date", jsonPath: ".status.since" },
  ],
  ...over,
});

describe("custom columns", () => {
  it("names the first column after the CRD's kind", () => {
    expect(customColumns(crd())[0].header).toBe("Widget");
  });

  it("gives each printer column a cell from the row's positional values", () => {
    const cols = customColumns(crd());
    const phase = cols.find((c) => c.header === "Phase")!;
    expect(phase.render!({ name: "w", namespace: "d", age: "1d", columns: ["Ready", "2026-01-01"] })).toBe("Ready");
  });

  it("drops the namespace column for a cluster-scoped CRD", () => {
    expect(customColumns(crd({ namespaced: false })).some((c) => c.key === "namespace")).toBe(false);
  });

  it("falls back to the generic set when the CRD declares no printer columns", () => {
    const cols = customColumns(crd({ printerColumns: [] }));
    expect(cols.map((c) => c.key)).toEqual(["name", "namespace", "age"]);
  });

  // `printerSortValue(type, value, sortKey)` takes three `string` parameters,
  // so a future argument swap at the call site in customColumns still
  // compiles. These pin the order by giving `columns` and `sortKeys` values
  // that disagree, so a swap changes the result rather than passing by luck.
  describe("printer column sort values", () => {
    it("sorts a string-typed column by its rendered value, not the raw sort key", () => {
      const cols = customColumns(crd());
      const phase = cols.find((c) => c.header === "Phase")!;
      const row = { name: "w", namespace: "d", age: "1d", columns: ["Ready"], sortKeys: ["NotReady"] };
      expect(phase.getSortValue!(row)).toBe("Ready");
    });

    it("sorts a date-typed column by its raw timestamp, not its rendered age text", () => {
      const cols = customColumns(crd());
      const since = cols.find((c) => c.header === "Since")!;
      const now = Date.now();
      // Rendered text says the opposite of the truth: "fresh" looks old
      // ("10d") and "stale" looks recent ("2h"). Only the raw sort key —
      // the third argument — carries the real age.
      // "Since" is the second printer column (index 1); index 0 is filler
      // for "Phase" so the positional lookup lands on the right entry.
      const fresh = {
        name: "a", namespace: "d", age: "1d",
        columns: ["Ready", "10d"], sortKeys: ["", new Date(now - 60_000).toISOString()],
      };
      const stale = {
        name: "b", namespace: "d", age: "1d",
        columns: ["Ready", "2h"], sortKeys: ["", new Date(now - 30 * 86_400_000).toISOString()],
      };
      expect(since.getSortValue!(fresh) as number).toBeLessThan(since.getSortValue!(stale) as number);
    });
  });
});

describe("customDescriptorFor", () => {
  it("resolves a slug that matches a CRD to a descriptor for that kind", () => {
    const descriptor = customDescriptorFor("widgets.example.com", [crd()]);
    expect(descriptor?.columns[0].header).toBe("Widget");
  });

  it("returns undefined for a slug that matches no CRD", () => {
    expect(customDescriptorFor("gadgets.example.com", [crd()])).toBeUndefined();
  });
});
