import { useEffect, useMemo, useRef, useState } from "react";
import { listCrds, type ClusterContext, type CrdRef } from "@srelens/core";
import { Mark, ResourceTree, Sidebar, StatusPill, type ResourceNode, type StatusKind } from "@srelens/ui-kit";
import { Icons } from "../lib/icons";
import { useMark } from "../lib/marks";
import { openTab, useActiveCluster, useTabs } from "../lib/tabsStore";
import { crdNodes, glyph, INVESTIGATE, kindNodes, NAV_GROUPS, routeForNode } from "../lib/tree";
import { useResource } from "../lib/useResource";
import { getView, setExpanded, toggleExpanded, useWorkspaceView, type LinkState } from "../lib/workspace";

export interface NavProps {
  /** Every cluster the machine knows. The active one is looked up in here by `stableId`. */
  contexts: ClusterContext[];
}

/** How each link state reads, and which of the kit's five kinds draws it. */
const LINK: Record<LinkState, { word: string; kind: StatusKind }> = {
  connected: { word: "Connected", kind: "success" },
  connecting: { word: "Connecting", kind: "info" },
  disconnected: { word: "Disconnected", kind: "neutral" },
  error: { word: "Error", kind: "danger" },
};

/** Before anything has probed the cluster there is nothing to claim about it. */
const UNKNOWN = { word: "Unknown", kind: "neutral" } as const;

/**
 * The groups that stand open the first time a window is used: everything the
 * tree builds with children, minus the two that ask to start shut.
 */
const DEFAULT_EXPANDED = [...NAV_GROUPS.map((g) => g.id), "investigate"];

/**
 * The id of the node the active tab is on, or `undefined` when the tab is on
 * something the tree does not offer (a resource detail, settings, a terminal).
 *
 * Found by asking each leaf where it goes rather than by turning the route back
 * into an id: `routeForNode` is the one direction that has to be right, and a
 * second mapping written the other way round is a second thing to keep in step.
 */
function nodeForRoute(nodes: ResourceNode[], crds: CrdRef[], route: string): string | undefined {
  for (const node of nodes) {
    if (node.children) {
      const inside = nodeForRoute(node.children, crds, route);
      if (inside) return inside;
    } else if (routeForNode(node.id, crds) === route) {
      return node.id;
    }
  }
  return undefined;
}

/**
 * The sidebar: whose cluster this is, a filter, and everything in it worth
 * opening — the built-in kinds, whatever CRDs this cluster has, and the app's
 * own screens.
 *
 * All of the drawing is the kit's; what lives here is the wiring the kit is not
 * allowed to know. The shape of the tree is `lib/tree.ts`, which is pure and
 * tested as data; this reads the active cluster out of the tab store, asks core
 * for the CRDs, opens tabs, and keeps the folds in the workspace view.
 *
 * Two decisions worth naming. Activating a row opens a *preview* tab, the way
 * a single click in an editor's file tree does: walking down a sidebar is
 * browsing, and browsing twenty kinds should not leave twenty tabs behind —
 * `openTab` promotes the preview as soon as the row is opened for real.
 *
 * And the folds are stored, not defaulted. The kit's tree takes `expanded` as
 * the whole truth when it is given at all, so an empty list would mean every
 * group shut on first launch; the workspace view is therefore seeded once per
 * mount with the groups that should stand open. Once per mount rather than
 * whenever the list is empty, because "the user closed all six" is a state the
 * sidebar has to be able to stay in.
 */
export function Nav({ contexts }: NavProps) {
  const activeCluster = useActiveCluster();
  const ctx = contexts.find((c) => c.stableId === activeCluster) ?? null;
  const view = useWorkspaceView();
  const [query, setQuery] = useState("");
  const mark = useMark(ctx?.stableId ?? "", ctx?.name ?? "");

  // Subscribes the sidebar to the strip: which row is highlighted is a fact
  // about the active tab, and that changes from a dozen places that are not here.
  const { tabs, activeId } = useTabs();
  const route = tabs.find((t) => t.id === activeId)?.route ?? "/";

  const name = ctx?.name;
  const discovery = useResource<CrdRef[]>(
    async () => {
      if (!name) return [];
      const out = await listCrds(name);
      // `listCrds` reports failure in the result rather than by rejecting, and
      // an empty tree is not the same news as "we were not allowed to look".
      if (out.error) throw new Error(out.error);
      return out.crds ?? [];
    },
    [name],
  );
  const crds = useMemo(() => discovery.data ?? [], [discovery.data]);

  const nodes = useMemo<ResourceNode[]>(
    () => [
      ...kindNodes(),
      { id: "crds", label: "Custom resources", icon: Icons.crds, defaultExpanded: false, children: crdNodes(crds) },
      {
        id: "investigate",
        label: "Investigate",
        icon: Icons.investigate,
        children: INVESTIGATE.map((i) => ({ id: `route:${i.route}`, label: i.label, icon: glyph(i.id) })),
      },
    ],
    [crds],
  );

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (getView().expanded.length === 0) setExpanded(DEFAULT_EXPANDED);
  }, []);

  const link = ctx ? (view.links[ctx.stableId] ? LINK[view.links[ctx.stableId].state] : UNKNOWN) : UNKNOWN;

  return (
    <Sidebar
      label="Cluster navigation"
      query={query}
      onQueryChange={setQuery}
      emptyTitle="No cluster selected"
      emptyHint="Pick a cluster from the rail to browse what is in it."
      header={
        ctx && (
          <div className="flex items-center gap-2">
            <Mark
              name={mark.name}
              short={mark.short}
              color={mark.color}
              size="sm"
              decorative
              withBadge={mark.withText}
              icon={mark.mark === "icon" && mark.icon ? glyph(mark.icon) : undefined}
              imageSrc={mark.mark === "image" ? mark.imageSrc : undefined}
            />
            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">{ctx.name}</span>
            <StatusPill status={link.word} kind={link.kind} />
          </div>
        )
      }
    >
      {ctx && (
        <ResourceTree
          label="Cluster resources"
          nodes={nodes}
          active={nodeForRoute(nodes, crds, route)}
          onActivate={(id) => {
            const next = routeForNode(id, crds);
            if (next) openTab(next, { preview: true, clusterName: ctx.name });
          }}
          expanded={view.expanded}
          onExpandedChange={toggleExpanded}
          query={query}
          error={
            discovery.status === "error"
              ? {
                  title: "Could not read this cluster",
                  detail: discovery.error,
                  onRetry: discovery.reload,
                }
              : undefined
          }
        />
      )}
    </Sidebar>
  );
}
