import { useEffect, useState } from "react";
import type { ClusterContext } from "@srelens/core";
import { Button, ClusterRail, CustomizeMark, Drawer, Mark, type ClusterRailItem } from "@srelens/ui-kit";
import { getMark, resetMark, setMark, useMark } from "../lib/marks";
import { useInfos } from "../lib/probe";
import { setActiveCluster, setWorkspaceClusters, useActiveCluster, useTabs } from "../lib/tabsStore";
import { useWorkspaceView } from "../lib/workspace";

export interface RailProps {
  contexts: ClusterContext[];
  /** Opens /connect. The rail knows the gesture, the window knows the route. */
  onConnect: () => void;
  /**
   * Why the cluster list could not be read — a kubeconfig that failed to
   * parse, usually. The saved cluster ids are kept and drawn once their
   * contexts come back, but until then the rail would otherwise be silently
   * empty with no way to tell "nothing configured" from "couldn't read it".
   */
  error?: string;
}

/**
 * The colours a cluster may be marked with.
 *
 * Tokens rather than hex, so a mark set in the dark theme is not a colour that
 * only worked there. Five, each named: {@link CustomizeMark} reads the label
 * aloud, and "#b4342a" names nothing. The custom picker beside them is still
 * there for anyone who wants a sixth.
 */
const PALETTE = [
  { value: "var(--accent)", label: "Accent" },
  { value: "var(--ok)", label: "Green" },
  { value: "var(--info)", label: "Blue" },
  { value: "var(--warn)", label: "Amber" },
  { value: "var(--sev)", label: "Red" },
];

/** An image mark is inlined into the settings file, so it has to stay small. */
const MAX_IMAGE_BYTES = 64 * 1024;

/**
 * The strip of cluster marks down the edge of the window, and the panel that
 * edits one of them.
 *
 * Everything drawn is the kit's; what lives here is the four stores the kit is
 * not allowed to see. The workspace says which clusters and in what order, the
 * contexts resolve those ids to something with a name and a server, the link
 * states say which are reachable, and the marks say what each one looks like.
 * Items are built from all four and handed over already ordered — a rail that
 * fetched any of it for itself would be a rail with one call site (#320).
 *
 * A cluster id with no matching context is skipped rather than drawn as a
 * placeholder. `reconcile` already drops ids whose context has gone, so this
 * only covers the window between a kubeconfig changing and the store catching
 * up, and a mark for a cluster that is not there is worse than one mark fewer.
 *
 * The menu gesture opens the drawer rather than a context menu. The kit's
 * ContextMenu needs an element ref to anchor to and the rail hands back an
 * event, not a ref; the drawer is where the two things this menu would offer —
 * customise, remove — already live, so the gesture opens it directly.
 *
 * The marks and the probes are read once for the whole list rather than once
 * per cluster: the number of clusters changes between renders, so a hook per
 * item would be a hook count that changes with the list, which React refuses.
 * `useInfos` is the probe store's whole-record snapshot, which exists for this.
 * The marks have no such hook, so the subscription rides on the `useMark` call
 * the drawer's editor needs anyway — that hook subscribes whatever id it is
 * asked about, so it re-renders this rail on any mark change and the items then
 * read the plain `getMark` beside it.
 */
export function Rail({ contexts, onConnect, error }: RailProps) {
  const { workspace } = useTabs();
  const active = useActiveCluster();
  const { links } = useWorkspaceView();
  const [editing, setEditing] = useState<string | null>(null);

  const byId = new Map(contexts.map((c) => [c.stableId, c]));
  const target = editing === null ? null : (byId.get(editing) ?? null);

  // One subscription each, standing in for the per-item hooks — see above.
  const value = useMark(target?.stableId ?? "", target?.name ?? "");
  const infos = useInfos();

  // A context can leave while its drawer is open — a kubeconfig rewritten under
  // the app. The drawer is already gone by then, since `target` cannot resolve;
  // this forgets which cluster it was about, so a context that comes back does
  // not bring a panel nobody asked for back with it.
  const stale = editing !== null && !byId.has(editing);
  useEffect(() => {
    if (stale) setEditing(null);
  }, [stale]);

  const items: ClusterRailItem[] = [];
  for (const id of workspace.clusters) {
    const ctx = byId.get(id);
    if (!ctx) continue;
    const mark = getMark(id, ctx.name);
    const info = infos[id];
    const link = links[id];
    items.push({
      id,
      name: ctx.name,
      // Named by the mark, which is where the initials come from when there is
      // no short text; the item's own `name` stays the context's, because that
      // is what the rail is a list of.
      mark: (
        <Mark
          decorative
          name={mark.name}
          short={mark.short}
          color={mark.color}
          imageSrc={mark.mark === "image" ? mark.imageSrc : undefined}
          withBadge={mark.withText}
          size="sm"
        />
      ),
      // The version first, because the server is the long half and the hint
      // truncates from the end.
      detail: [info?.version, ctx.server].filter(Boolean).join(" · "),
      // A reason rather than a flag: the kit dims the mark and says the word,
      // so the state is never told in opacity alone. An error with no message
      // still has to say something.
      unavailable:
        link?.state === "error"
          ? (link.error ?? "Unreachable")
          : link?.state === "disconnected"
            ? "Disconnected"
            : undefined,
      markers: link?.state === "connecting" ? [{ label: "Connecting", tone: "info" }] : [],
      color: mark.color,
    });
  }

  function remove(id: string) {
    setWorkspaceClusters(
      workspace.id,
      workspace.clusters.filter((c) => c !== id),
    );
    setEditing(null);
  }

  return (
    <>
      <ClusterRail
        items={items}
        activeId={active ?? undefined}
        onSelect={setActiveCluster}
        onMenu={(id) => setEditing(id)}
        onAdd={onConnect}
        error={error}
      />
      {target && (
        <Drawer open title={target.name} onClose={() => setEditing(null)}>
          <CustomizeMark
            value={value}
            onChange={(next) => setMark(target.stableId, next)}
            onReset={() => resetMark(target.stableId)}
            colors={PALETTE}
            maxImageBytes={MAX_IMAGE_BYTES}
          />
          <div className="mt-3 flex justify-end px-3">
            <Button variant="danger" size="sm" onClick={() => remove(target.stableId)}>
              Remove from workspace
            </Button>
          </div>
        </Drawer>
      )}
    </>
  );
}
