import type { ReactNode } from "react";
import {
  ageFromTimestamp,
  asArray,
  asRecord,
  relatedPodSelector,
  str,
  type Condition,
  type K8sObject,
} from "@srelens/core";
import { KV } from "@srelens/ui-kit";
import { Section } from "./Section";
import { ConditionsSection, RelatedPodsSection, StringList } from "./sections";

/**
 * The four kinds classic's `ObjectDetail` special-cases with their own
 * "Properties" section (`PodDetailsBody`, `WorkloadDetailsBody` for
 * Deployment/StatefulSet/ReplicaSet) — each already covers the same
 * Namespace/Created/Labels/Annotations/Controlled-by facts this wrapper's
 * identity block and its Labels/Annotations blocks would add, which is why
 * classic renders them without its generic wrapper (`GenericDetail`) at all.
 * Every other kind — including DaemonSet, which classic does NOT special-case
 * here even though it has its own body — falls through to `GenericBody`,
 * alone or with a `DETAILS_BODY` entry nested inside it.
 */
export const SELF_DESCRIBING_KINDS: ReadonlySet<string> = new Set([
  "Pod",
  "Deployment",
  "StatefulSet",
  "ReplicaSet",
]);


/**
 * A kind's identity — classic's `GenericDetail` "Metadata" section, minus the
 * two things the design's own frame settles differently.
 *
 * No heading. The design heads the first block of a detail with nothing: the
 * pane's header has already given the name, the kind and the namespace, and a
 * "Metadata" bar under it is a second name for the same thing.
 *
 * No `Name` row either, for the same reason — it repeated the header verbatim
 * on every kind, which is a carry-over from classic rather than a decision.
 * `Created` reads as an age alone (`84d ago`); the absolute stamp classic
 * appended is a second rendering of one fact in a 352px column.
 *
 * Labels and Annotations are no longer rows here at all — squeezed into the
 * value column of a fact list, a `key=value` pair had about a third of the
 * pane to be read in. They are blocks of their own below.
 *
 * Namespace and Controlled by are a `ResourceLink`/`LinkedResources` in
 * classic that navigate — Namespace to the Namespace object, Controlled by to
 * each owner's own kind/name; neither can navigate here (`PaneBody` has no
 * navigation contract — see the task report), so both render as plain text.
 *
 * An object with none of these facts renders no block at all: an empty section
 * still has its padding and still draws a rule against whatever follows it.
 */
function IdentitySection({ object }: { object: K8sObject }) {
  const meta = object.metadata ?? {};
  const owners = meta.ownerReferences ?? [];
  const created = str(meta.creationTimestamp);
  if (!meta.namespace && !created && owners.length === 0) return null;

  return (
    <Section>
      {meta.namespace && <KV k="Namespace" v={str(meta.namespace)} mono />}
      {created && <KV k="Created" v={`${ageFromTimestamp(created, Date.now())} ago`} />}
      {owners.length > 0 && (
        <KV k="Controlled by" v={<StringList items={owners.map((o) => `${o.kind}/${o.name}`)} />} />
      )}
    </Section>
  );
}

/**
 * The Details pane's fallback wrapper — classic's `GenericDetail`, on the
 * design's own shape: a flat run of blocks divided by hairline rules, not a
 * stack of cards. The identity facts come first and unheaded, then the kind's
 * own `DETAILS_BODY` entry nested inside (`children`, classic's `KindBody`)
 * where one exists, then related pods (where `relatedPodSelector` finds a
 * selector for this kind), then Conditions, Labels and Annotations — the
 * order the design's own frames read in.
 *
 * Every block is a sibling of every other, with nothing wrapped around any of
 * them: `.section + .section` is what draws the rule between two blocks, so a
 * div around one would quietly remove the rule on both sides of it. A block
 * with nothing to say renders nothing at all rather than an empty section, and
 * the rules then land in the right places on their own — nothing counts blocks
 * or is told which one is first.
 *
 * Labels and Annotations are NOT here. They close every kind's detail, so
 * they are the host's to place rather than the body's — the peek stacks them
 * under the rest and the full tab reads them side by side, and a body that
 * rendered them itself could only ever produce one of those. They used to be
 * rendered in three files (here, `PodBody`, `WorkloadBody`), guarded in the
 * third by a `SELF_DESCRIBING_KINDS` check whose only job was to stop them
 * appearing twice; placing them once, above, retires that guard along with
 * the class of bug it was watching for. (#331)
 *
 * `ResourceDetailView` wraps every kind's Details pane in this component; for the
 * four `SELF_DESCRIBING_KINDS` it passes through `children` untouched, since
 * those kinds' own bodies already show the facts this wrapper would otherwise
 * duplicate. Adding a kind to `DETAILS_BODY` nests it here automatically, and
 * a kind with no entry still gets a complete, correct detail from this wrapper
 * alone.
 */
export function GenericBody({
  kind,
  object,
  context,
  children,
}: {
  kind: string;
  object: K8sObject;
  context: string;
  children?: ReactNode;
}) {
  if (SELF_DESCRIBING_KINDS.has(kind)) return <>{children}</>;

  const meta = object.metadata ?? {};
  const namespace = str(meta.namespace);
  const conditions = asArray(asRecord(object.status).conditions) as unknown as Condition[];
  const podSelector = relatedPodSelector(kind, object);
  const hasPodSelector = Object.keys(podSelector).length > 0;

  return (
    <>
      <IdentitySection object={object} />
      {children}
      {context && namespace && hasPodSelector && (
        <RelatedPodsSection context={context} namespace={namespace} selector={podSelector} />
      )}
      <ConditionsSection conditions={conditions} />
    </>
  );
}
