import { ageSortValue, eventVerdict } from "@srelens/core";
import { AskChip, StatusPill, type Column } from "@srelens/ui-kit";
import type { KindDescriptor, ListRow } from "./types";

/**
 * One row of the events table.
 *
 * Field for field, core's `EventSummary`. `namespace` is redeclared required,
 * narrowing `ListRow`'s optional one: the backend sends it on every event —
 * empty for a cluster-scoped one, which is an answer and not an absence — so
 * no reader of a row needs a branch for it being missing. Declared here rather
 * than as `EventSummary & ListRow` so the screen and the by-reason rail name
 * one type, and so the watch's payload is checked against it rather than
 * assumed.
 */
export interface EventRow extends ListRow {
  namespace: string;
  type: string;
  reason: string;
  object: string;
  message: string;
  count: number;
  age: string;
}

/** What separates a kind from a name in `EventSummary.object`. */
const SEPARATOR = "/";

/** No value where the design expects one — the same em dash `columns.tsx` uses. */
const NONE = "—";

/** §8's own width for the Object cell, past which it truncates. */
const OBJECT_MAX_WIDTH = 220;

/**
 * Which namespace an event came from. Empty for a cluster-scoped one (an event
 * about a Node), which is a real answer and not a missing one.
 *
 * This once recovered the namespace by splitting `row.name`, which the backend
 * keys as `<namespace>/<name>`. That worked, and rested on "an event's own name
 * can never contain a slash" — true, but a rule written down nowhere. The
 * backend now reports the namespace outright, so this reads it: a key's shape
 * is the key's business, and nothing in the UI should depend on it.
 *
 * Kept as a function, and kept exported, though it now returns a field. The
 * screen, the Namespace column and the by-reason rail were all pointed here on
 * purpose so this change would be invisible to them; inlining it would give the
 * next change to where a namespace comes from three call sites to find instead
 * of one.
 */
export function eventNamespace(row: EventRow): string {
  return row.namespace;
}

/**
 * `Pod/web-1` as the design writes it: `pod/web-1`.
 *
 * Only the kind is lowered — a name is case-sensitive to the API server, and
 * lowercasing one would render an object that cannot be looked up by what the
 * row shows. A value with no kind in front of it is left exactly as it is.
 */
function objectPath(object: string): string {
  const cut = object.indexOf(SEPARATOR);
  if (cut === -1) return object;
  return `${object.slice(0, cut).toLocaleLowerCase()}${object.slice(cut)}`;
}

/**
 * The design's eight columns minus the trailing ask, which {@link withEventAsk}
 * layers on where the console is in reach (§8's table, in its order).
 *
 * Nothing here pairs a word with a tone. The Type cell asks core's
 * {@link eventVerdict} for both channels — the pill's tone and whether its word
 * is worth colouring — so a `Warning` in this table and a `Warning` in the
 * detail pane's events tab cannot disagree about what a warning looks like.
 */
export const eventColumns: Column<EventRow>[] = [
  {
    key: "type",
    header: "Type",
    sortable: true,
    render: (e) => {
      const { health, bad } = eventVerdict(e.type);
      // A pill with no word is a bare coloured dot — the one thing StatusPill
      // exists to prevent. A cluster that sent no type still gets a word.
      return <StatusPill status={e.type || NONE} kind={health} tinted={bad} />;
    },
  },
  { key: "reason", header: "Reason", sortable: true, render: (e) => <span className="font-medium">{e.reason}</span> },
  {
    key: "object",
    header: "Object",
    sortable: true,
    // Truncated at the design's own width, with the full value on hover. The
    // design gives only Message a title, but it truncates this one too, and a
    // truncated object with no way to read the rest is a cell you cannot use.
    render: (e) => (
      <span className="path block truncate" style={{ maxWidth: OBJECT_MAX_WIDTH }} title={objectPath(e.object)}>
        {objectPath(e.object)}
      </span>
    ),
    getValue: (e) => objectPath(e.object),
  },
  {
    key: "namespace",
    header: "Namespace",
    sortable: true,
    render: (e) => <span className="path">{eventNamespace(e) || NONE}</span>,
    // Sorts and filters on what the cell shows. Without this the default
    // reads `row.namespace`, which is `undefined` on every watched event —
    // and `String(undefined)` is how a table comes to render "undefined".
    getValue: eventNamespace,
  },
  {
    key: "message",
    header: "Message",
    // A paragraph of prose has no natural order — the same reason the pod
    // table leaves its comma-joined image list unsortable. It still joins the
    // toolbar's whole-row search, which is how a reader finds one.
    sortable: false,
    render: (e) => (
      <span className="path block truncate text-faint" title={e.message}>
        {e.message}
      </span>
    ),
  },
  { key: "count", header: "Count", sortable: true, align: "end", render: (e) => <span className="path">{e.count}</span> },
  {
    key: "age",
    header: "Age",
    sortable: true,
    align: "end",
    // Takes the row, not the age string: `ageSortValue` reads `row.age` so a
    // column can hand it straight over by name.
    getSortValue: ageSortValue,
    render: (e) => <span className="path text-faint">{e.age}</span>,
  },
];

/** What "ask about this event" asks — one phrasing, wherever it is drawn (§8). */
export function eventAskQuestion(row: EventRow): string {
  return `Explain this event: ${row.reason} — ${row.message}`;
}

/**
 * The eighth column: the hover-only ask chip.
 *
 * Layered by the screen rather than baked into the descriptor, exactly as
 * `withRowAffordances` is for every other list — the descriptor is data and
 * has no console to hand a question to, and a column the reader can neither
 * sort nor hide has no business in the column picker.
 *
 * Its own function rather than `withRowAffordances` because an event asks a
 * different question (the design's, above) and has no name column to hang an
 * unhealthy dot off: an event is a report, not a resource with a health.
 */
export function withEventAsk(
  columns: Column<EventRow>[],
  ask: (question: string) => void,
): Column<EventRow>[] {
  return [
    ...columns,
    {
      key: "ask",
      header: "",
      sortable: false,
      filterable: false,
      render: (row: EventRow) => <AskChip question={eventAskQuestion(row)} onAsk={ask} />,
    },
  ];
}

/**
 * Events as a kind the resource-list engine can drive.
 *
 * `watch` because `events` is in core's `WATCHABLE_KINDS` — the backend
 * streams them rather than re-listing, which is what keeps a chatty cluster's
 * table current without a poll. No `load`, for the same reason.
 *
 * `actions: {}` — there is no action to take on an event. Nothing to delete
 * meaningfully, nothing to scale, nothing to restart; classic disables bulk
 * selection on this kind for the same reason.
 *
 * And no `flagged`: an event has no health of its own to report. A `Warning`
 * describes something that happened to another object; giving the row a dot
 * would put a second, quieter copy of the Type column beside it.
 */
export const EVENT_DESCRIPTOR: KindDescriptor<EventRow> = {
  k8sKind: "Event",
  columns: eventColumns,
  source: "watch",
  scope: "namespaced",
  actions: {},
};
