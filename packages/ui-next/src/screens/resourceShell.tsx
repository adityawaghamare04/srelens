import { Alert, Button, EmptyState, MultiSelect, Screen, Spinner, type Column, type TableSort } from "@srelens/ui-kit";
import { toggleColumn } from "../lib/columnPrefs";
import { setTabView, useTabs, useTabView } from "../lib/tabsStore";

/**
 * Shell pieces `Resources.tsx` (one kind per `/k/<slug>` tab) and
 * `Workloads.tsx` (five kinds unioned at `/resources`) both need, verbatim.
 *
 * A whole-branch review found a batch of fixes landing on `Resources.tsx`
 * that never reached `Workloads.tsx`, because the shell the two screens open
 * with was duplicated rather than shared — there was nowhere for a fix
 * applied once to live. What's here is only the pieces that are *actually*
 * identical between the two: the no-cluster guard, the namespace picker's
 * loading/error treatment, and the tab-bound sort/filter/filterKey plumbing.
 *
 * What's deliberately NOT here: the row-menu wiring, the list-loading and
 * per-kind error banners, and the table itself. `Resources.tsx` composes
 * around one descriptor and one row type; `Workloads.tsx` aggregates five
 * fixed watches into a union row. Forcing those through one shared component
 * would cost a worse abstraction than the duplication it replaces — see the
 * two screens' own module comments.
 */

/** The guard both screens open with: no cluster in focus, so there is no
 *  context name to call core with, and a hook cannot be skipped — this is a
 *  `return` before any hook runs, not a branch inside a hook-calling body. */
export function NoClusterScreen({ title, noun }: { title: string; noun: string }) {
  return (
    <Screen title={title} fill>
      <EmptyState
        title="No cluster in focus"
        hint={`Pick a cluster in the rail to list its ${noun}.`}
        className="flex-1"
      />
    </Screen>
  );
}

/**
 * The namespace picker's two states: a disabled, spinning stand-in while
 * `namespaces` is still `null`, and the real picker once it has answered.
 * Zero options while `namespaces` is null reads as "this cluster has no
 * namespaces" — a bare `MultiSelect options={(namespaces ?? []).map(...)}`
 * says exactly that, which is what let this drift between the two screens in
 * the first place.
 */
export function NamespacePicker({
  namespaces,
  selection,
  onChange,
}: {
  namespaces: string[] | null;
  selection: string[];
  onChange: (next: string[]) => void;
}) {
  if (namespaces === null) {
    return (
      <Button variant="secondary" className="justify-between gap-1.5" disabled aria-label="Namespaces">
        <Spinner label="Loading namespaces" />
        Loading namespaces…
      </Button>
    );
  }
  return (
    <MultiSelect
      options={namespaces.map((ns) => ({ value: ns }))}
      selection={selection}
      onChange={onChange}
      allLabel="All namespaces"
      ariaLabel="Namespaces"
    />
  );
}

/**
 * `useNamespaceOptions`'s failure, surfaced rather than swallowed. Non-fatal:
 * the hook keeps whatever namespaces it had before the failure, so the picker
 * and the rows both keep working — this only says the list behind the picker
 * may be incomplete.
 */
export function NamespaceErrorAlert({ error }: { error: string }) {
  if (!error) return null;
  return (
    <Alert tone="warn" title="Namespaces could not be listed" className="mx-3 mt-3 mb-3">
      {error}
    </Alert>
  );
}

export interface ResourceTabView {
  tabId: string;
  sort: TableSort | null;
  filter: string;
  filterKey: string | null;
  setFilter: (value: string) => void;
  setSort: (next: TableSort | null) => void;
  setFilterKey: (key: string | null) => void;
}

/**
 * Sort, filter text and filter column live on the route's own tab, so they
 * survive a restart with it (#254) — component state would pass every render
 * assertion and lose all three on the next launch. This screen's *own* tab,
 * not whichever one is active: `Window` mounts every tab's body and merely
 * hides the inactive ones, so reading the active tab's view would have a
 * background list re-sorting and re-filtering itself on every keystroke
 * typed in an unrelated tab.
 *
 * `filterKey` is derived rather than merely cleared when a column is hidden:
 * hidden columns belong to the kind and are shared by every tab looking at
 * it, while the filter key belongs to one tab — so the column a filter key
 * names can be hidden from another tab, in another workspace, while this one
 * is not even mounted, and both halves persist independently.
 */
export function useResourceTabView<T>(route: string, columns: readonly Column<T>[]): ResourceTabView {
  const { tabs } = useTabs();
  const tabId = tabs.find((tab) => tab.route === route)?.id ?? "";
  const view = useTabView(tabId);
  const sort = view.sort ?? null;
  const filter = view.filter ?? "";
  const filterKey = view.filterKey && columns.some((column) => column.key === view.filterKey) ? view.filterKey : null;
  return {
    tabId,
    sort,
    filter,
    filterKey,
    setFilter: (value) => setTabView(tabId, { filter: value }),
    setSort: (next) => setTabView(tabId, { sort: next }),
    setFilterKey: (key) => setTabView(tabId, { filterKey: key }),
  };
}

/** `ColumnPicker`'s own shape, built from the kind's (or the union's) full
 *  column set — before hiding, so a hidden column can still be re-offered. */
export function columnOptionsFor<T>(columns: readonly Column<T>[]): { key: string; label: string }[] {
  return columns.map((column) => ({
    key: column.key,
    label: typeof column.header === "string" ? column.header : column.key,
  }));
}

/** Hiding the column the search is pointed at leaves a filter nobody can see
 *  and nothing can match — the classic design shipped exactly that. */
export function toggleColumnVisibility(params: {
  key: string;
  storageKey: string;
  hidden: ReadonlySet<string>;
  filterKey: string | null;
  tabId: string;
}): void {
  const { key, storageKey, hidden, filterKey, tabId } = params;
  if (!hidden.has(key) && filterKey === key) setTabView(tabId, { filterKey: null });
  toggleColumn(storageKey, key);
}

/** "This kind has none" and "the filter matched none" are different facts,
 *  and the second one is the reader's own doing — same wording, same
 *  distinction, in both screens. */
export function emptyTableCopy(
  count: number,
  noun: string,
  clusterName: string,
  scopeSuffix: string,
): { emptyText: string; emptyHint: string } {
  return count === 0
    ? { emptyText: `No ${noun}`, emptyHint: `${clusterName} has no ${noun}${scopeSuffix}.` }
    : { emptyText: `No ${noun} match this filter`, emptyHint: `Clear the filter to see all ${count}.` };
}
