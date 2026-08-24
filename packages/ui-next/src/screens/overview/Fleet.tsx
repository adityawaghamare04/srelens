import { podCount, type ClusterContext, type PodCount } from "@srelens/core";
import { KV, Spinner } from "@srelens/ui-kit";
import { useResource, type Resource } from "../../lib/useResource";
import { LINK_WORD } from "../../lib/workspace";

export interface FleetProps {
  /** Every cluster in this workspace, in the rail's own order. */
  clusters: ClusterContext[];
  /** The cluster this overview is about. Always drawn, see below. */
  active: ClusterContext;
}

/**
 * `Fleet` — one row per cluster in the workspace, with how much of each is up.
 *
 * **THE FAILURE MODES ARE THE DESIGN.** Everything below follows from one
 * sentence: the overview is about THIS cluster, and Fleet is a courtesy.
 *
 * **Concurrent, and isolated.** There is no fan-out here to fail — no
 * `Promise.all`, no gathered list, nothing that awaits one cluster before
 * asking the next. Every row is its own component with its own `useResource`,
 * so the calls all leave in the same effect flush and each answer lands in the
 * row it belongs to. One cluster's refusal is one row's refusal, and a cluster
 * that never answers holds up nothing at all — not this section, and not the
 * capacity strip or the nodes table beside it.
 *
 * **Each row owns its state, and there is deliberately NO aggregate spinner.**
 * A "Loading fleet" over the section would let the one unreachable cluster
 * hide the nine that answered in half a second, which is the opposite of what
 * a summary is for. A row is either counting, a count, or unreachable with the
 * reason it gave.
 *
 * **A cluster that did not answer is never a zero.** `podCount` carries its
 * own 3-second timeout in the backend and reports a timeout as an error rather
 * than as `{ running: 0, total: 0 }`; that distinction is preserved all the
 * way here, because "0/0" for a cluster nobody reached is a lie the reader has
 * no way to catch. {@link count} below is what keeps it: an outcome carrying
 * an error becomes a rejection, never a count.
 *
 * **This cluster is in the list.** `active` is prepended when the workspace's
 * own list has lost it — a window between a kubeconfig changing and the store
 * reconciling — because a fleet summary that omits the cluster the reader is
 * looking at is a summary of everywhere except here.
 */
export function Fleet({ clusters, active }: FleetProps) {
  const rows = clusters.some((c) => c.stableId === active.stableId)
    ? clusters
    : [active, ...clusters];

  // A fragment, so the rows land as direct children of whatever laid the
  // section out — the same reason `KVList` has no wrapper of its own.
  return (
    <>
      {rows.map((ctx) => (
        <FleetRow key={ctx.stableId} context={ctx} />
      ))}
    </>
  );
}

/** An outcome-shaped count, turned into the rejection `useResource` reads. */
async function count(context: string): Promise<PodCount> {
  const out = await podCount(context);
  // Never `?? { running: 0, total: 0 }`. See the note above.
  if (out.error) throw new Error(out.error);
  if (!out.counts) throw new Error("podCount returned no counts");
  return out.counts;
}

/**
 * One cluster's row, and the whole of its isolation.
 *
 * A component per row rather than a loop over one hook: the number of clusters
 * changes between renders, and a hook per item would be a hook count that
 * changes with the list, which React refuses. It is also what makes the
 * isolation structural rather than remembered — there is no shared state for
 * one cluster's failure to reach.
 */
function FleetRow({ context }: { context: ClusterContext }) {
  const counts = useResource(() => count(context.name), [context.name]);

  return <KV k={context.name} v={<Reading name={context.name} counts={counts} />} />;
}

function Reading({
  name,
  counts,
}: {
  name: string;
  counts: Resource<PodCount>;
}) {
  if (counts.error) {
    return (
      <>
        {/* The same word the status bar uses for a cluster it could not
            reach, from the same table — a second word for the same fact is
            how two readouts of one cluster start disagreeing. */}
        {LINK_WORD.error}
        <span className="block text-faint">{counts.error}</span>
      </>
    );
  }
  if (!counts.data) {
    // This row's own indicator, named for this row's own cluster.
    return <Spinner label={`Counting pods on ${name}`} />;
  }
  // Named, not a bare pair of numbers: "30/33" says nothing about what was
  // counted, and the not-ready list's trailing facts settled the same point.
  // `total` excludes `Succeeded` pods — the backend does that, see
  // `crates/kube/src/pod_count.rs` — so a cluster whose Jobs have all
  // finished reads 30/30 rather than claiming three pods are down.
  return <>{`${counts.data.running}/${counts.data.total} running`}</>;
}
