import {
  asRecord,
  describeError,
  getObject,
  podContainerChoices,
  podsForSelector,
  type FriendlyError,
  type Invoker,
  type LogTarget,
} from "@srelens/core";

/**
 * A route's subject, resolved to the pods and containers a stream can open
 * against.
 *
 * A subject is a **pod** or a **workload**. A workload resolves through
 * `getObject` for its selector, then `podsForSelector` for its pods; each
 * pod's containers come from `getObject`. Both of those report failure by
 * returning `{ error }` rather than throwing — this module never wraps them
 * in a `try/catch` and calls that error handling; it reads the field.
 *
 * **The stream must not open until every in-scope pod's containers are
 * known.** Classic gates on exactly this. Opening against an incomplete
 * target set silently drops a container's lines, and nobody notices — logs
 * are *expected* to be sparse, so a missing container looks exactly like a
 * quiet one. `resolveLogSubject` is therefore all-or-nothing: it fetches
 * every in-scope pod's containers before returning anything, and one failed
 * fetch fails the whole resolution rather than handing back however many
 * pods happened to answer first.
 */

/** A single pod, named by the route. */
export interface PodSubject {
  type: "pod";
  context: string;
  namespace: string;
  name: string;
}

/**
 * A workload, named by kind + name. `kind` is whatever `getObject`
 * understands — Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, or any
 * kind whose `spec.selector.matchLabels` names its pods.
 */
export interface WorkloadSubject {
  type: "workload";
  context: string;
  namespace: string;
  kind: string;
  name: string;
}

export type LogSubject = PodSubject | WorkloadSubject;

/**
 * What `resolveLogSubject` produces.
 *
 * `"resolved"` is the only state that carries targets, and it always carries
 * at least one — see the module doc for why a partial list is never
 * returned, and note the guarantee is about *targets*, not pods: a workload
 * whose pods exist but whose containers all resolve to nothing (every pod's
 * `spec.containers` empty, however that could happen) is exactly as
 * unfollowable as one with no pods, so `"empty"` gates on the target count,
 * not the pod count — a `"resolved"` with zero targets would be a lie, and
 * it is the caller's target list that matters, not how many pods contributed
 * to it. `"error"` covers every failure along the way — the
 * workload's own `getObject`, `podsForSelector`, or a pod's `getObject` (which
 * is also how a pod subject whose pod has gone is reported) — already run
 * through `describeError` so a screen can render it without inventing a
 * second error path.
 */
export type LogSubjectResolution =
  | { status: "resolved"; targets: LogTarget[] }
  | { status: "empty"; detail: string }
  | { status: "error"; error: FriendlyError };

/** The label a matchLabels selector would carry on a workload's spec, read
 *  loosely so a spec that doesn't have one just yields no pods. */
function selectorOf(object: unknown): Record<string, string> {
  const spec = asRecord(asRecord(object).spec);
  const matchLabels = asRecord(spec.selector).matchLabels;
  return (matchLabels ?? {}) as Record<string, string>;
}

/** The pod names in scope for `subject` — itself for a pod, or its
 *  selector's matches for a workload. */
async function podsInScope(
  subject: LogSubject,
  invoke: Invoker | undefined,
): Promise<{ pods: string[] } | { error: string }> {
  if (subject.type === "pod") return { pods: [subject.name] };

  const workload = await getObject(subject.context, subject.kind, subject.namespace, subject.name, invoke);
  if (workload.error !== undefined) return { error: workload.error };

  const out = await podsForSelector(subject.context, subject.namespace, selectorOf(workload.object), invoke);
  if (out.error !== undefined) return { error: out.error };
  return { pods: (out.pods ?? []).map((p) => p.name) };
}

/**
 * Resolve a route's subject to the concrete pod/container targets a stream
 * can open against, or say why it can't yet.
 *
 * Only app containers (`spec.containers`, via `podContainerChoices`) become
 * targets — matching what classic followed for a log stream's target list.
 * An init container has already run to completion by the time a pod is worth
 * watching, and an ephemeral debug container is a separate, deliberate
 * action a reader takes on purpose, not something a log stream tails unasked.
 *
 * Lines are labelled only when more than one target is in scope; a single
 * pod, single container stream carries no label. When they are labelled, the
 * label is `pod` alone if every target in scope shares the same container
 * name — naming the container would repeat the one word on every row, which
 * is noise, not information, in a 200px gutter — and `pod/container`
 * otherwise, when containers actually need disambiguating. That fact is
 * decided here, once, and lives on each target's own `label` rather than as
 * a flag a caller has to recompute: a screen (or the stream itself) reads
 * `target.label` and is done.
 */
export async function resolveLogSubject(
  subject: LogSubject,
  invoke?: Invoker,
): Promise<LogSubjectResolution> {
  const scope = await podsInScope(subject, invoke);
  if ("error" in scope) return { status: "error", error: describeError(scope.error) };

  if (scope.pods.length === 0) {
    return {
      status: "empty",
      detail:
        subject.type === "workload"
          ? `${subject.kind}/${subject.name} has no pods to follow.`
          : `${subject.name} has no pods to follow.`,
    };
  }

  // All-or-nothing: every pod's containers are fetched before any target is
  // built. `getObject` never throws, so this `Promise.all` always settles —
  // a failed fetch shows up as `{ error }` on its own result, not a rejection
  // that would race the others.
  const objects = await Promise.all(
    scope.pods.map((pod) => getObject(subject.context, "Pod", subject.namespace, pod, invoke)),
  );
  const failed = objects.find((o) => o.error !== undefined);
  if (failed !== undefined) return { status: "error", error: describeError(failed.error) };

  const raw = scope.pods.flatMap((pod, i) =>
    podContainerChoices(objects[i].object)
      .filter((c) => c.kind === "app")
      .map((c) => ({ pod, container: c.name })),
  );

  // Every in-scope pod answered, but none of them had an app container to
  // follow — as unfollowable as no pods at all, and "resolved" with an empty
  // target list would say otherwise. Gate on what a caller can actually use.
  if (raw.length === 0) {
    return {
      status: "empty",
      detail:
        subject.type === "workload"
          ? `${subject.kind}/${subject.name} has no containers to follow.`
          : `${subject.name} has no containers to follow.`,
    };
  }

  const label = raw.length > 1;
  const singleContainerName = new Set(raw.map((r) => r.container)).size <= 1;
  const targets: LogTarget[] = raw.map(({ pod, container }) => ({
    pod,
    container,
    label: !label ? "" : singleContainerName ? pod : `${pod}/${container}`,
  }));

  return { status: "resolved", targets };
}
