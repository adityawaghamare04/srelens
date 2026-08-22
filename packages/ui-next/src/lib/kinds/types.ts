import type { Column } from "@srelens/ui-kit";

/** The least every listed row has: what the table keys and acts on. */
export interface ListRow {
  name: string;
  namespace?: string;
}

/** Which row actions a kind offers. Absent, not disabled — see the spec. */
export interface KindActions {
  logs?: boolean;
  shell?: boolean;
  forward?: boolean;
  scale?: boolean;
  restart?: boolean;
  evict?: boolean;
}

/**
 * Everything the list screen needs to know about one kind, as data.
 *
 * The screen names no kind: it looks one of these up and composes. That is
 * what makes the 24 typed column sets a table a reviewer can read rather than
 * 24 branches in a component, and what lets the column and sort behaviour be
 * tested without rendering anything.
 */
export interface KindDescriptor<Row extends ListRow = ListRow> {
  /** The Kubernetes kind, for actions and for the detail route. */
  k8sKind: string;
  columns: Column<Row>[];
  /** `watch` streams snapshots; `poll` re-lists on an interval. */
  source: "watch" | "poll";
  scope: "namespaced" | "cluster";
  /** Required for `poll`; unused for `watch`. */
  load?: (context: string, namespace: string) => Promise<{ rows?: Row[]; error?: string }>;
  /** Extra per-row data merged by name — pod metrics, node metrics. */
  enrich?: (context: string, namespace: string) => Promise<Map<string, Partial<Row>>>;
  enrichMs?: number;
  actions: KindActions;
}
