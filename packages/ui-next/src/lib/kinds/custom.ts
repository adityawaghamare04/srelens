import {
  ageSortValue,
  listCustomResource,
  printerColumnKeys,
  printerSortValue,
  type CrdRef,
  type CustomRow,
} from "@srelens/core";
import type { Column } from "@srelens/ui-kit";
import type { KindDescriptor } from "./types";

/**
 * A custom resource's table, built from the printer columns the API server
 * declares for it. Keys come from `printerColumnKeys` rather than the
 * column's index: hidden columns and the tab's sort key persist under them,
 * and a positional key would move a user's choices the day an operator
 * upgrade inserts or reorders `additionalPrinterColumns`.
 */
export function customColumns(crd: CrdRef): Column<CustomRow>[] {
  const printers = crd.printerColumns ?? [];
  const keys = printerColumnKeys(printers);
  const columns: Column<CustomRow>[] = [
    { key: "name", header: crd.kind, sortable: true },
  ];
  if (crd.namespaced) {
    columns.push({ key: "namespace", header: "Namespace", sortable: true });
  }
  printers.forEach((printer, index) => {
    columns.push({
      key: keys[index],
      header: printer.name,
      sortable: true,
      render: (row) => row.columns?.[index] ?? "—",
      getSortValue: (row) => printerSortValue(printer.type, row.columns?.[index] ?? "", row.sortKeys?.[index]),
    });
  });
  columns.push({ key: "age", header: "Age", sortable: true, getSortValue: ageSortValue });
  return columns;
}

/** The descriptor for one discovered CRD. */
export function customDescriptor(crd: CrdRef): KindDescriptor<CustomRow> {
  return {
    k8sKind: crd.kind,
    columns: customColumns(crd),
    source: "poll",
    scope: crd.namespaced ? "namespaced" : "cluster",
    load: (context, namespace) =>
      listCustomResource(context, crd, namespace || null).then((o) => ({ rows: o.items, error: o.error })),
    actions: {},
  };
}

/**
 * The descriptor for a route slug that names a custom resource, or
 * `undefined` when this cluster has no such CRD — a route string can arrive
 * from a session persisted against a cluster that has since lost the
 * operator.
 */
export function customDescriptorFor(
  slug: string,
  crds: CrdRef[],
): KindDescriptor<CustomRow> | undefined {
  const crd = crds.find((c) => c.name === slug);
  return crd ? customDescriptor(crd) : undefined;
}
