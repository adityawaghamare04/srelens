import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useColumnVisibility } from "./useColumnVisibility";
import type { Column } from "./Table";

interface Row {
  name: string;
}

const columns: Column<Row>[] = [
  { key: "name", header: "Name" },
  { key: "status", header: "Status" },
  { key: "age", header: "Age" },
  { key: "actions", header: "" }, // headerless — a row-actions cell
];

beforeEach(() => localStorage.clear());

describe("useColumnVisibility", () => {
  it("lists only labelled columns and pins the first", () => {
    const { result } = renderHook(() => useColumnVisibility("nodes", columns));
    expect(result.current.pinnedKey).toBe("name");
    // The headerless "actions" column is not offered.
    expect(result.current.columnOptions.map((c) => c.key)).toEqual(["name", "status", "age"]);
    // All columns visible by default.
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual(["name", "status", "age", "actions"]);
  });

  it("hides a column, keeps identifier and headerless columns, and persists", () => {
    const { result } = renderHook(() => useColumnVisibility("nodes", columns));
    act(() => result.current.toggle("status"));
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual(["name", "age", "actions"]);
    expect(JSON.parse(localStorage.getItem("srelens.hiddenColumns")!)).toEqual({ nodes: ["status"] });

    // The pinned identifier and headerless columns can't be hidden.
    act(() => result.current.toggle("name"));
    act(() => result.current.toggle("actions"));
    expect(result.current.visibleColumns.map((c) => c.key)).toEqual(["name", "age", "actions"]);
  });

  it("loads persisted hidden columns and isolates views by key", () => {
    localStorage.setItem("srelens.hiddenColumns", JSON.stringify({ nodes: ["age"], pods: ["status"] }));
    const nodes = renderHook(() => useColumnVisibility("nodes", columns));
    expect(nodes.result.current.visibleColumns.map((c) => c.key)).toEqual(["name", "status", "actions"]);
    const pods = renderHook(() => useColumnVisibility("pods", columns));
    expect(pods.result.current.visibleColumns.map((c) => c.key)).toEqual(["name", "age", "actions"]);
  });
});
