import { useState } from "react";
import {
  deleteResource,
  evictPod,
  rolloutRestart,
  runBulk,
  summarize,
  type BulkOutcome,
} from "@srelens/core";
import { ActionBar, ConfirmDialog, type ActionBarAction } from "@srelens/ui-kit";
import type { KindDescriptor, ListRow } from "../lib/kinds/types";

export interface ResourceBulkProps {
  /** Row keys the table's own checkbox column reports — `Table`'s
   *  `selection.selected`, verbatim. Never a second key scheme. */
  selected: Set<string>;
  /** Lowercase, plural — "pods", "deployments" — for the count and the confirm. */
  kind: string;
  descriptor: KindDescriptor;
  context: string;
  /** The rows the selection was drawn from; keys are resolved back through
   *  the same formula `Table`'s `getRowKey` uses, never parsed apart. */
  rows: ListRow[];
  /** Called once the run finishes, whatever its outcome — the caller clears
   *  the selection. */
  onDone: () => void;
}

type ActionType = "delete" | "evict" | "restart";

/** The same key `Resources.tsx` hands `Table` as `getRowKey`. Kept as one
 *  literal formula rather than two, so a namespace can never go missing on
 *  the way from a checkbox to a write. */
function keyOf(row: ListRow): string {
  return `${row.namespace ?? ""}/${row.name}`;
}

/** `namespace/name` — every target this screen writes to is qualified, so an
 *  all-namespaces view showing two `web-0`s never confuses which one a bulk
 *  action reaches. */
function rowLabel(row: ListRow): string {
  return row.namespace ? `${row.namespace}/${row.name}` : row.name;
}

const VERB: Record<ActionType, string> = { delete: "Delete", evict: "Evict", restart: "Restart" };
const PAST: Record<ActionType, string> = { delete: "deleted", evict: "evicted", restart: "restarted" };

/** What's waiting on a confirm: the action and the exact rows it was opened
 *  for — a snapshot, so a selection change under an open dialog can't retarget it. */
interface Pending {
  type: ActionType;
  rows: ListRow[];
}

/** The finished run's per-row detail, once at least one row failed. A full
 *  success needs no report — it just closes. */
interface Report {
  type: ActionType;
  outcomes: BulkOutcome<ListRow>[];
}

function opFor(type: ActionType, context: string, kind: string) {
  return (row: ListRow) => {
    const ns = row.namespace ?? "";
    switch (type) {
      case "delete":
        return deleteResource(context, kind, row.namespace ?? null, row.name);
      case "evict":
        return evictPod(context, ns, row.name);
      case "restart":
        return rolloutRestart(context, kind, ns, row.name);
    }
  };
}

/**
 * The bulk action bar over a resource list's checkbox selection: absent when
 * nothing is selected, one confirm for the whole batch (never one per row),
 * and — because a partial failure is a fact about the cluster's actual state,
 * not a detail to swallow — a report naming exactly which rows succeeded and
 * which did not when the run comes back mixed.
 *
 * Every write goes through `row.namespace` off the resolved row, never a
 * substring of the selection key: two same-named resources in different
 * namespaces are two different targets, and only the row itself (not a
 * reparsed string) can say which is which.
 */
export function ResourceBulk({ selected, kind, descriptor, context, rows, onDone }: ResourceBulkProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  if (selected.size === 0 && !pending && !report) return null;

  const selectedRows = rows.filter((row) => selected.has(keyOf(row)));

  function open(type: ActionType) {
    setReport(null);
    setPending({ type, rows: selectedRows });
  }

  function close() {
    setPending(null);
    setReport(null);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    const outcomes = await runBulk(pending.rows, opFor(pending.type, context, descriptor.k8sKind));
    setBusy(false);
    const { failed } = summarize(outcomes);
    const { type } = pending;
    onDone();
    if (failed === 0) {
      close();
      return;
    }
    setPending(null);
    setReport({ type, outcomes });
  }

  const actions: ActionBarAction[] = [];
  if (descriptor.actions.restart) {
    actions.push({ id: "restart", label: "Restart rollout", danger: true, onSelect: () => open("restart") });
  }
  if (descriptor.actions.evict) {
    actions.push({ id: "evict", label: "Evict", danger: true, onSelect: () => open("evict") });
  }
  actions.push({ id: "delete", label: "Delete", danger: true, onSelect: () => open("delete") });

  return (
    <>
      {selected.size > 0 && (
        // The table runs flush to the panel now (f088d92); this bar sits in
        // the same container, so — like the stale-rows Alert next to it —
        // it carries its own inset instead of borrowing the container's.
        <div className="mx-3 mt-3 mb-3 flex items-center gap-2">
          <span className="text-muted text-[0.8125rem]">{selected.size} selected</span>
          <ActionBar actions={actions} label={`${kind} actions`} />
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title={`${VERB[pending.type]} ${pending.rows.length} ${kind}?`}
          danger
          busy={busy}
          confirmLabel={VERB[pending.type]}
          onConfirm={() => void confirm()}
          onCancel={close}
          message={
            <>
              <p style={{ marginTop: 0 }}>
                This will {VERB[pending.type].toLowerCase()} {pending.rows.length} {kind}
                {pending.type === "delete" ? " — this cannot be undone" : ""}:
              </p>
              <ul>
                {pending.rows.map((row) => (
                  <li key={keyOf(row)}>
                    <code>{rowLabel(row)}</code>
                  </li>
                ))}
              </ul>
            </>
          }
        />
      )}
      {report && (
        <ConfirmDialog
          title={`${report.outcomes.length} ${kind}: ${summarize(report.outcomes).ok} ${PAST[report.type]}, ${
            summarize(report.outcomes).failed
          } failed`}
          confirmLabel="Close"
          cancelLabel="Close"
          onConfirm={close}
          onCancel={close}
          message={
            <ul>
              {report.outcomes.map((outcome) => (
                <li key={keyOf(outcome.item)}>
                  <code>{rowLabel(outcome.item)}</code>
                  {" — "}
                  {outcome.status === "ok" ? PAST[report.type] : `failed: ${outcome.error}`}
                </li>
              ))}
            </ul>
          }
        />
      )}
    </>
  );
}
