import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Table, filterTableData, type Column } from "./Table";

interface Row {
  name: string;
  phase: string;
}

const columns: Column<Row>[] = [
  { key: "name", header: "Name" },
  { key: "phase", header: "Phase", render: (r) => <em>{r.phase}</em> },
];

const data: Row[] = [
  { name: "web-1", phase: "Running" },
  { name: "web-2", phase: "Pending" },
];

describe("Table", () => {
  it("renders headers and rows, using custom cell renderers", () => {
    render(<Table columns={columns} data={data} getRowKey={(r) => r.name} />);
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("web-1")).toBeDefined();
    // custom render wraps phase in <em>
    expect(screen.getByText("Running").tagName).toBe("EM");
  });

  it("fires onRowClick with the clicked row", () => {
    const onRowClick = vi.fn();
    render(
      <Table columns={columns} data={data} getRowKey={(r) => r.name} onRowClick={onRowClick} />,
    );
    fireEvent.click(screen.getByText("web-2"));
    expect(onRowClick).toHaveBeenCalledWith({ name: "web-2", phase: "Pending" });
  });

  it("marks the selected row via aria-selected", () => {
    render(
      <Table columns={columns} data={data} getRowKey={(r) => r.name} selectedKey="web-1" />,
    );
    const selected = screen.getByText("web-1").closest("tr");
    expect(selected?.getAttribute("aria-selected")).toBe("true");
  });

  it("shows empty text when there is no data", () => {
    render(
      <Table columns={columns} data={[]} getRowKey={(r) => r.name} emptyText="No pods" />,
    );
    expect(screen.getByText("No pods")).toBeDefined();
  });

  it("cycles column sorting through ascending, descending, and unsorted", () => {
    render(<Table columns={columns} data={[...data].reverse()} getRowKey={(r) => r.name} />);
    const sort = screen.getByRole("button", { name: "Sort by Name" });

    fireEvent.click(sort);
    expect(screen.getAllByRole("row")[1].textContent).toContain("web-1");
    fireEvent.click(sort);
    expect(screen.getAllByRole("row")[1].textContent).toContain("web-2");
    fireEvent.click(sort);
    expect(screen.getAllByRole("row")[1].textContent).toContain("web-2");
  });

  it("selects a column for the toolbar search", () => {
    const onChange = vi.fn();
    render(
      <Table
        columns={columns}
        data={data}
        getRowKey={(r) => r.name}
        onActiveFilterKeyChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter search by Phase" }));
    expect(onChange).toHaveBeenCalledWith("phase");
  });

  it("filters globally or by the selected column", () => {
    expect(filterTableData(data, columns, "running", null)).toEqual([data[0]]);
    expect(filterTableData(data, columns, "web", "phase")).toEqual([]);
    expect(filterTableData(data, columns, "web-2", "name")).toEqual([data[1]]);
  });

  it("resizes a column with the keyboard and resets it on double click", () => {
    render(<Table columns={columns} data={data} getRowKey={(r) => r.name} />);
    const handle = screen.getByRole("separator", { name: "Resize Name column" });
    const header = screen.getByText("Name").closest("th");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(header?.closest("table")?.style.width).toBe("256px");
    fireEvent.doubleClick(handle);
    expect(header?.closest("table")?.style.width).toBe("");
  });
});
