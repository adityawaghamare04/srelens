import { AskChip, toneColor, type Column } from "@srelens/ui-kit";
import type { ListRow } from "./types";

/** The row identifier: always the name column, never one this decorates twice. */
const NAME_KEY = "name";

/**
 * The two row affordances the design mock has that the classic port lacked —
 * shared by every screen that lists rows, rather than duplicated per one.
 * `Resources.tsx` and `Workloads.tsx` each built this independently because
 * the parallel dispatches that wrote them drew file-ownership boundaries
 * between the two; there is no behavioural reason for two copies.
 *
 * An unhealthy dot rides in the name cell, never colour alone: the reason
 * goes beside it as `sr-only` text, the same "a word, not just a tint"
 * contract the cluster rail's `unavailable` follows (`ClusterRail.tsx`).
 *
 * A trailing ask chip sends the row to the console dock, naming the actual
 * resource and its state — kept out of the caller's own column set (and so
 * out of `ColumnPicker`) because it is not a column a reader would ever hide.
 *
 * `isFlagged` is the one thing that differs between callers: `Resources.tsx`
 * asks a `KindDescriptor`'s `flagged` function, `Workloads.tsx` reads a
 * `flagged` boolean the row already carries (five kinds already reduced to
 * one shape by the time it gets here). Taking a function rather than either
 * of those directly is what lets one implementation serve both.
 */
export function withRowAffordances<Row extends ListRow>(
  columns: Column<Row>[],
  isFlagged: (row: Row) => boolean,
  ask: (question: string) => void,
): Column<Row>[] {
  const decorated = columns.map((column) => {
    if (column.key !== NAME_KEY) return column;
    const render = column.render;
    return {
      ...column,
      render: (row: Row) => (
        <span className="flex items-center gap-1.5">
          {isFlagged(row) && (
            <>
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: toneColor("sev") }}
              />
              <span className="sr-only">Needs attention</span>
            </>
          )}
          <span className="truncate">{render ? render(row) : row.name}</span>
        </span>
      ),
    };
  });
  return [
    ...decorated,
    {
      key: "ask",
      header: "",
      sortable: false,
      filterable: false,
      render: (row: Row) => (
        <AskChip
          question={isFlagged(row) ? `Why is ${row.name} unhealthy?` : `What is ${row.name} using right now?`}
          onAsk={ask}
        />
      ),
    },
  ];
}
