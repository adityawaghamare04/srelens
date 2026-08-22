import { K8S_KIND, WATCHABLE_KINDS, listResource, type ResourceKind } from "@srelens/core";
import type { Column } from "@srelens/ui-kit";
import { genericClusterColumns, genericColumns } from "./generic";
import type { KindDescriptor, ListRow } from "./types";

/** Classic's list, unchanged: the kinds that have no namespace. */
export const CLUSTER_SCOPED: readonly ResourceKind[] = [
  "nodes", "namespaces", "persistentvolumes", "storageclasses", "priorityclasses",
  "runtimeclasses", "mutatingwebhookconfigurations", "validatingwebhookconfigurations",
  "ingressclasses", "clusterroles", "clusterrolebindings",
];

const isWatchable = (kind: string) => (WATCHABLE_KINDS as readonly string[]).includes(kind);
const isClusterScoped = (kind: string) => (CLUSTER_SCOPED as readonly string[]).includes(kind);

/**
 * The typed entries. A kind absent from here is served by the generic
 * descriptor below — deliberately, and only for the kinds the backend has
 * nothing more to say about. `descriptors.test.ts` asserts the whole sidebar
 * resolves, so a kind that *should* be typed cannot slip through as generic.
 *
 * Keyed on `ListRow` rather than the brief's shorthand `never`: `never` makes
 * every entry's row type bottom, which types the empty table below but leaves
 * no room for Tasks 4 and 5 to add a `KindDescriptor<PodRow>` here without a
 * cast at the call site. `ListRow` is the actual lower bound `descriptorFor`
 * promises callers — the widening is confined to this table and to
 * `descriptorFor`'s per-kind casts below; nothing exported gets looser.
 */
const TYPED: Partial<Record<ResourceKind, KindDescriptor<ListRow>>> = {};

/**
 * `overview`, `portforwards`, `helmreleases`, `settings` and friends are in
 * core's `ResourceKind` union for the classic sidebar's sake and have no
 * Kubernetes kind behind them; `K8S_KIND` is `""` for each. They are screens,
 * not lists.
 */
function isListable(slug: string): slug is ResourceKind {
  return Object.prototype.hasOwnProperty.call(K8S_KIND, slug) && K8S_KIND[slug as ResourceKind] !== "";
}

export function descriptorFor(slug: string): KindDescriptor<ListRow> | undefined {
  if (!isListable(slug)) return undefined;
  const typed = Object.prototype.hasOwnProperty.call(TYPED, slug) ? TYPED[slug] : undefined;
  if (typed) return typed;
  const cluster = isClusterScoped(slug);
  return {
    k8sKind: K8S_KIND[slug],
    // `genericColumns` is typed over core's `ResourceRow` (name, namespace,
    // age), which is a proper subtype of `ListRow` — so the reverse cast here
    // is the variance-safe direction: every function on these columns already
    // tolerates a row with fewer fields than `ResourceRow` promises (the only
    // one, `ageSortValue`, reads an optional `age`), TypeScript just can't see
    // that through `Column`'s contravariant row parameter.
    columns: (cluster ? genericClusterColumns : genericColumns) as Column<ListRow>[],
    source: isWatchable(slug) ? "watch" : "poll",
    scope: cluster ? "cluster" : "namespaced",
    load: (context, namespace) =>
      listResource(context, K8S_KIND[slug], namespace).then((o) => ({ rows: o.items, error: o.error })),
    actions: {},
  };
}
