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
