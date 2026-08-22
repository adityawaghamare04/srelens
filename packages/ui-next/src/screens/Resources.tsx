import { useEffect, useMemo, useState } from "react";
import {
  listCrds,
  rowInSelection,
  watchNamespaceForSelection,
  type ClusterContext,
  type CrdRef,
} from "@srelens/core";
import { useNamespaceOptions } from "@srelens/core/react";
import {
  Alert,
  AskChip,
  ColumnPicker,
  EmptyState,
  ErrorState,
  FilterBar,
  LiveSignal,
  LoadingState,
  MultiSelect,
  Screen,
  Table,
  filterTableData,
  toneColor,
  type Column,
} from "@srelens/ui-kit";
import { useConsole } from "../console";
import { getKubeconfigFiles, useActiveContext } from "../lib/clusters";
import { toggleColumn, useHiddenColumns } from "../lib/columnPrefs";
import { customDescriptorFor } from "../lib/kinds/custom";
import { descriptorFor } from "../lib/kinds/descriptors";
import type { KindDescriptor, ListRow } from "../lib/kinds/types";
import { useResourceList } from "../lib/resourceList";
import { describe, isBuiltInKind } from "../lib/routes";
import { openTab, setTabView, useTabs, useTabView } from "../lib/tabsStore";
import { useResource } from "../lib/useResource";
import { setNamespaces, useNamespaces } from "../lib/workspace";
import { ResourceBulk } from "./ResourceBulk";
import { useRowMenu } from "./ResourceMenu";

/** The row identifier: always shown, never offered to the column picker. */
const NAME_KEY = "name";

/** Stable identity for "no columns", so a memo on it does not churn. */
const NO_COLUMNS: Column<ListRow>[] = [];

/**
 * The two row affordances the design mock has and the classic port lacked —
 * composed here once for whatever descriptor the screen is showing, rather
 * than duplicated per typed column set. `flagged` is the only per-kind
 * knowledge either one needs, and most kinds have none.
 *
 * An unhealthy dot rides in the name cell, never colour alone: the reason
 * goes beside it as `sr-only` text, the same "a word, not just a tint"
 * contract the cluster rail's `unavailable` follows (`ClusterRail.tsx`).
 *
 * A trailing ask chip sends the row to the console dock, naming the actual
 * resource and its state — kept out of `descriptor.columns` (and so out of
 * `ColumnPicker`) because it is not a column a reader would ever hide.
 */
function withRowAffordances(
  columns: Column<ListRow>[],
  descriptor: KindDescriptor<ListRow> | undefined,
  ask: (question: string) => void,
): Column<ListRow>[] {
  if (!descriptor) return columns;
  const flagged = descriptor.flagged;
  const decorated = columns.map((column) => {
    if (column.key !== NAME_KEY) return column;
    const render = column.render;
    return {
      ...column,
      render: (row: ListRow) => (
        <span className="flex items-center gap-1.5">
          {flagged?.(row) && (
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
      render: (row: ListRow) => (
        <AskChip
          question={
            flagged?.(row) ? `Why is ${row.name} unhealthy?` : `What is ${row.name} using right now?`
          }
          onAsk={ask}
        />
      ),
    },
  ];
}

/**
 * The resource list: one screen for every `/k/<slug>` route there is.
 *
 * It names no kind. The slug is looked up as a descriptor — a built-in one for
 * core's kinds, or one built from the cluster's own CRDs — and everything on
 * screen is composed around that: the columns, the scope, whether there is a
 * namespace picker, whether the rows arrive on a watch or a poll. That is what
 * lets 34 sidebar entries plus every custom resource an operator installed
 * share a single screen instead of 34 near-copies.
 *
 * Split in two because of the guard rail at the top: with no cluster in focus
 * there is no context name to call core with, and a hook cannot be skipped.
 * The half below the split is only ever mounted once there is one.
 */
export function Resources({ route }: { route: string }) {
  const context = useActiveContext();
  const slug = route.slice("/k/".length);
  // The tab strip already knows what this route is called; asking `describe`
  // keeps the screen's title and the tab's title the same string.
  const title = describe(route, context?.name).title;

  if (!context) {
    return (
      <Screen title={title} fill>
        <EmptyState
          title="No cluster in focus"
          hint="Pick a cluster in the rail to list its resources."
          className="flex-1"
        />
      </Screen>
    );
  }

  return <KindList route={route} slug={slug} title={title} context={context} />;
}

function KindList({
  route,
  slug,
  title,
  context,
}: {
  route: string;
  slug: string;
  title: string;
  context: ClusterContext;
}) {
  // Core takes a context *name*; the workspace holds a `stableId`. The two are
  // never interchangeable — see `lib/clusters`.
  const name = context.name;
  const files = getKubeconfigFiles();
  const builtIn = isBuiltInKind(slug);
  const { ask } = useConsole();

  // Discovery runs only for a slug that is not one of core's kinds: listing
  // pods must not cost a CRD round trip, and must not fail on a cluster whose
  // RBAC refuses `listCRDs`.
  const discovery = useResource<CrdRef[]>(
    async () => {
      if (builtIn) return [];
      const out = await listCrds(name);
      // `listCrds` reports failure in its result rather than by rejecting, and
      // "this cluster has no such CRD" is different news from "we were not
      // allowed to look".
      if (out.error) throw new Error(out.error);
      return out.crds ?? [];
    },
    [name, builtIn],
  );
  const crds = discovery.data;

  const descriptor = useMemo(() => {
    if (builtIn) return descriptorFor(slug);
    if (!crds) return undefined;
    // The same variance cast `descriptors.ts` makes for its typed column sets:
    // `CustomRow` is a proper subtype of `ListRow` on the data side, but
    // `Column`'s render/sort functions take the row contravariantly, so
    // TypeScript cannot see the assignment is safe. Every function on a custom
    // column only reads fields `ListRow` does not promise (`columns`,
    // `sortKeys`), so a bare `ListRow` cannot reach one wrongly.
    return customDescriptorFor(slug, crds) as KindDescriptor<ListRow> | undefined;
  }, [builtIn, slug, crds]);

  const selection = useNamespaces(context.stableId);
  const { namespaces, scope } = useNamespaceOptions(name, files);

  // A namespace-restricted credential has one namespace and no way to ask for
  // another. Written to the workspace store rather than held here, so every
  // screen looking at this cluster follows the same scope.
  useEffect(() => {
    if (scope) setNamespaces(context.stableId, [scope]);
  }, [scope, context.stableId]);

  const clusterScoped = descriptor?.scope === "cluster";
  // One selected namespace is watched directly; none or several are watched
  // across the cluster and narrowed below, which is core's own rule.
  const namespace = clusterScoped ? "" : watchNamespaceForSelection(selection);
  const list = useResourceList<ListRow>(name, slug, descriptor, namespace, files);

  const hidden = useHiddenColumns(slug);
  const allColumns = descriptor?.columns ?? NO_COLUMNS;
  const columns = useMemo(
    // The identifier is never hidden: a table whose rows lost their name is
    // not a table any more. `ColumnPicker` pins the same key.
    () => allColumns.filter((column) => column.key === NAME_KEY || !hidden.has(column.key)),
    [allColumns, hidden],
  );
  // The dot and the ask chip, layered on after hiding — not offered to
  // `ColumnPicker` (which is built from `allColumns` below) and not part of
  // what `filterTableData` searches.
  const renderedColumns = useMemo(
    () => withRowAffordances(columns, descriptor, ask),
    [columns, descriptor, ask],
  );

  // Sort, filter text and filter column live on the tab, so they survive a
  // restart with it (#254). Component state would pass every render assertion
  // and lose all three on the next launch.
  //
  // This screen's *own* tab, not whichever one is active: `Window` mounts every
  // tab's body and merely hides the inactive ones, so reading the active tab's
  // view would have a background list re-sorting and re-filtering itself on
  // every keystroke typed in an unrelated tab. A workspace holds one tab per
  // route, which is what makes the route an exact handle on it.
  const { tabs } = useTabs();
  const tabId = tabs.find((tab) => tab.route === route)?.id ?? "";
  const view = useTabView(tabId);
  const sort = view.sort ?? null;
  const filter = view.filter ?? "";
  // Derived rather than merely cleared when this screen hides a column. Hidden
  // columns belong to the kind and are shared by every tab looking at it; the
  // filter key belongs to one tab. So the column this tab's key names can be
  // hidden from another tab — in another workspace, while this one is not even
  // mounted — and both halves persist, which is how the classic design ended
  // up with search boxes pointed at columns that were no longer there,
  // matching nothing and saying nothing, for the rest of the session.
  const filterKey =
    view.filterKey && columns.some((column) => column.key === view.filterKey) ? view.filterKey : null;

  const rows = useMemo(
    () =>
      clusterScoped
        ? list.rows
        : list.rows.filter((row) => rowInSelection(row.namespace ?? "", selection)),
    [list.rows, clusterScoped, selection],
  );
  const filtered = useMemo(
    () => filterTableData(rows, columns, filter, filterKey),
    [rows, columns, filter, filterKey],
  );

  // Called unconditionally — same reason every hook above it is: the guard
  // for "no descriptor yet" is a `return` below, not a skip, and a hook
  // cannot follow one. `descriptorFor`'s own kind and actions feed it when
  // there is a descriptor; an absent one leaves the row menu with nothing to
  // gate on, which is moot since no row ever renders without one.
  const { items: rowMenuItems, dialog: rowMenuDialog } = useRowMenu({
    context: name,
    kind: descriptor?.k8sKind ?? "",
    actions: descriptor?.actions ?? {},
  });

  // The checkbox column's selection. Table owns the interaction (toggle,
  // shift-click range, select-all-of-filtered); this screen only holds the
  // set and hands it to `ResourceBulk`, which resolves each key back to a
  // row through the same `getRowKey` formula passed to `Table` below.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const lower = title.toLocaleLowerCase();

  function onToggleColumn(key: string) {
    // Hiding the column the search is pointed at leaves a filter nobody can
    // see and nothing can match — the classic design shipped exactly that.
    if (!hidden.has(key) && filterKey === key) setTabView(tabId, { filterKey: null });
    toggleColumn(slug, key);
  }

  if (!descriptor) {
    return (
      <Screen title={title} eyebrow={name} fill>
        {!builtIn && discovery.status === "loading" ? (
          <LoadingState label={`Looking for ${slug}`} />
        ) : discovery.status === "error" ? (
          <ErrorState
            title={`Could not look up ${slug}`}
            detail={discovery.error}
            onRetry={discovery.reload}
          />
        ) : (
          // A route string outlives the cluster it was written against: a tab
          // restored from a session can name a custom resource whose operator
          // has since been uninstalled. Naming the slug is what tells the
          // reader which tab to close.
          <ErrorState
            title={`Nothing on ${name} is called ${slug}`}
            detail="It is neither one of the kinds srelens knows nor a custom resource this cluster has. If an operator defined it, that operator may be gone."
            onRetry={builtIn ? undefined : discovery.reload}
          />
        )}
      </Screen>
    );
  }

  const columnOptions = allColumns.map((column) => ({
    key: column.key,
    label: typeof column.header === "string" ? column.header : column.key,
  }));

  return (
    <Screen
      title={title}
      eyebrow={name}
      fill
      actions={
        <>
          {descriptor.source === "watch" && (
            <LiveSignal
              // The label carries the meaning; the tone only colours it.
              label={list.watch === "live" ? "Live" : "Stream lost"}
              tone={list.watch === "live" ? "ok" : "warn"}
            />
          )}
          <ColumnPicker
            columns={columnOptions}
            hidden={hidden}
            onToggle={onToggleColumn}
            pinnedKey={NAME_KEY}
          />
        </>
      }
    >
      <FilterBar
        value={filter}
        onValueChange={(value) => setTabView(tabId, { filter: value })}
        label={`Filter ${lower}`}
        placeholder={`Filter ${lower}…`}
      >
        {!clusterScoped && (
          <MultiSelect
            options={(namespaces ?? []).map((ns) => ({ value: ns }))}
            selection={selection}
            onChange={(next) => setNamespaces(context.stableId, next)}
            allLabel="All namespaces"
            ariaLabel="Namespaces"
          />
        )}
      </FilterBar>

      <div className="scroll min-h-0 flex-1">
        {list.status === "loading" ? (
          <LoadingState label={`Loading ${lower}`} />
        ) : list.status === "error" ? (
          <ErrorState
            title={`Could not list ${lower} on ${name}`}
            detail={list.error}
            onRetry={list.reload}
          />
        ) : (
          <>
            {list.error && (
              // Rows and an error together: the last good list is still on
              // screen and is no longer being refreshed. Emptying the table
              // would throw away the only information the reader has. The
              // table itself runs flush to the panel now, so the alert
              // carries its own inset rather than borrowing the container's.
              <Alert tone="warn" title={`These ${lower} are stale`} className="mx-3 mt-3 mb-3">
                {list.error}
              </Alert>
            )}
            <ResourceBulk
              selected={selected}
              kind={lower}
              descriptor={descriptor}
              context={name}
              rows={filtered}
              onDone={() => setSelected(new Set())}
            />
            <Table
              columns={renderedColumns}
              data={filtered}
              getRowKey={(row) => `${row.namespace ?? ""}/${row.name}`}
              selection={{ selected, onChange: setSelected }}
              sort={sort}
              onSortChange={(next) => setTabView(tabId, { sort: next })}
              activeFilterKey={filterKey}
              onActiveFilterKeyChange={(key) => setTabView(tabId, { filterKey: key })}
              onRowActivate={(row) => openTab(`/resources/${encodeURIComponent(row.name)}`, { clusterName: name })}
              rowMenu={rowMenuItems}
              rowMenuLabel={`${title} actions`}
              // "This kind has none" and "the filter matched none" are
              // different facts, and the second one is the reader's own doing.
              emptyText={rows.length === 0 ? `No ${lower}` : `No ${lower} match this filter`}
              emptyHint={
                rows.length === 0
                  ? `${name} has no ${lower}${clusterScoped ? "" : " in the namespaces you are looking at"}.`
                  : `Clear the filter to see all ${rows.length}.`
              }
            />
          </>
        )}
      </div>
      {/* Outside the scrolling table body: a `ConfirmDialog` is a portal
          anyway, but a clipped ancestor is one fewer thing to reason about. */}
      {rowMenuDialog}
    </Screen>
  );
}
