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
  ColumnPicker,
  ErrorState,
  FilterBar,
  LiveSignal,
  LoadingState,
  Screen,
  Table,
  filterTableData,
  type Column,
} from "@srelens/ui-kit";
import { useConsole } from "../console";
import { getKubeconfigFiles, useActiveContext } from "../lib/clusters";
import { useHiddenColumns } from "../lib/columnPrefs";
import { customDescriptorFor } from "../lib/kinds/custom";
import { descriptorFor } from "../lib/kinds/descriptors";
import { withRowAffordances } from "../lib/kinds/rowAffordances";
import type { KindDescriptor, ListRow } from "../lib/kinds/types";
import { useResourceList } from "../lib/resourceList";
import { describe, isBuiltInKind } from "../lib/routes";
import { useResource } from "../lib/useResource";
import { setNamespaces, useNamespaces } from "../lib/workspace";
import { ResourceBulk } from "./ResourceBulk";
import { useRowMenu } from "./ResourceMenu";
import {
  NamespaceErrorAlert,
  NamespacePicker,
  NoClusterScreen,
  columnOptionsFor,
  emptyTableCopy,
  openResourceTab,
  toggleColumnVisibility,
  useResourceTabView,
} from "./resourceShell";

/** The row identifier: always shown, never offered to the column picker. */
const NAME_KEY = "name";

/** Stable identity for "no columns", so a memo on it does not churn. */
const NO_COLUMNS: Column<ListRow>[] = [];

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
    return <NoClusterScreen title={title} noun="resources" />;
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
  const { namespaces, scope, error: namespaceError } = useNamespaceOptions(name, files);

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
  // what `filterTableData` searches. `flagged` is the only per-kind
  // knowledge either affordance needs, and most kinds have none; with no
  // descriptor yet, columns pass through undecorated, same as before.
  const renderedColumns = useMemo(
    () =>
      descriptor
        ? withRowAffordances(columns, (row) => descriptor.flagged?.(row) ?? false, ask)
        : columns,
    [columns, descriptor, ask],
  );

  // Sort, filter text and filter column live on the tab — see
  // `useResourceTabView`'s own comment for why, and why `filterKey` is
  // derived rather than merely cleared when this screen hides a column.
  const { tabId, sort, filter, filterKey, setFilter, setSort, setFilterKey } = useResourceTabView(route, columns);

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

  // A namespace switch makes every selected key's namespace half meaningless
  // — cleared rather than left to be silently resolved away, or a later
  // switch back to a namespace that still has the same-named row would
  // resurrect a checkbox the reader never re-checked. `selection` is a
  // stable array reference from `useNamespaces` (it only changes identity
  // when its contents actually change), so this does not fire on every
  // render.
  useEffect(() => setSelected(new Set()), [selection]);

  const lower = title.toLocaleLowerCase();

  function onToggleColumn(key: string) {
    toggleColumnVisibility({ key, storageKey: slug, hidden, filterKey, tabId });
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

  const columnOptions = columnOptionsFor(allColumns);

  // Loading and error each replace the table with their own state below; the
  // stale-rows alert and the bulk bar only ever mean something once there is
  // a table to warn about or select from.
  const showRows = list.status !== "loading" && list.status !== "error";

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
        onValueChange={setFilter}
        label={`Filter ${lower}`}
        placeholder={`Filter ${lower}…`}
      >
        {!clusterScoped && (
          <NamespacePicker
            namespaces={namespaces}
            selection={selection}
            onChange={(next) => setNamespaces(context.stableId, next)}
          />
        )}
      </FilterBar>

      {!clusterScoped && <NamespaceErrorAlert error={namespaceError} />}

      {showRows && list.error && (
        // Rows and an error together: the last good list is still on screen
        // and is no longer being refreshed. Emptying the table would throw
        // away the only information the reader has. Pinned above the
        // scrolling table rather than inside it (D6+D7 review) — a "these
        // rows are stale" warning the reader scrolls past no longer warns
        // anyone. The table runs flush to the panel, so the alert carries
        // its own inset rather than borrowing the container's.
        <Alert tone="warn" title={`These ${lower} are stale`} className="mx-3 mt-3 mb-3">
          {list.error}
        </Alert>
      )}
      {showRows && (
        // Same reason as the alert above: selection actions that scroll out
        // of reach while the selection persists are worse than a warning
        // nobody sees.
        <ResourceBulk
          selected={selected}
          kind={lower}
          descriptor={descriptor}
          context={name}
          rows={filtered}
          onDone={() => setSelected(new Set())}
        />
      )}
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
          <Table
            columns={renderedColumns}
            data={filtered}
            getRowKey={(row) => `${row.namespace ?? ""}/${row.name}`}
            selection={{ selected, onChange: setSelected }}
            sort={sort}
            onSortChange={setSort}
            activeFilterKey={filterKey}
            onActiveFilterKeyChange={setFilterKey}
            onRowActivate={(row) => openResourceTab(row.name, name)}
            rowMenu={rowMenuItems}
            rowMenuLabel={`${title} actions`}
            {...emptyTableCopy(rows.length, lower, name, clusterScoped ? "" : " in the namespaces you are looking at")}
          />
        )}
      </div>
      {/* Outside the scrolling table body: a `ConfirmDialog` is a portal
          anyway, but a clipped ancestor is one fewer thing to reason about. */}
      {rowMenuDialog}
    </Screen>
  );
}
