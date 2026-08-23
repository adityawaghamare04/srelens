import { conditionKind, type Condition } from "@srelens/core";
import { KV, Section, StatusPill } from "@srelens/ui-kit";

export interface ConditionsSectionProps {
  /**
   * The conditions to print, in the order they should read. Ordering is the
   * caller's — a Pod's lifecycle runs PodScheduled to Ready
   * (`orderPodConditions`), a workload's does not — and nothing here reorders
   * them.
   */
  conditions: Condition[];
}

/**
 * An object's conditions: one row each, the condition's name beside its
 * status and reason.
 *
 * The one implementation, replacing three. Conditions used to render a
 * sortable four-column `Table` for a generic kind, a three-part flex row for a
 * Pod, and — for a Deployment, the kind the design's own frame illustrates —
 * a bare row of pills carrying neither the status value nor the reason, so the
 * one thing a reader opens the block for was the one thing missing. Three
 * renderings of the same data is three chances to disagree about it, and they
 * did. (#331)
 *
 * Conditions arrive as data, never as an object to read: the module has no
 * idea whether it is printing a Pod's, a Node's or a Deployment's, which is
 * what lets every body share it. `conditionKind` is core's single severity
 * heuristic, so a condition is toned the same way wherever it appears.
 *
 * The name is `tinted`, which colours it for a bad state and leaves it plain
 * for a good one — red `Available` above a plain `ReplicaFailure`, both beside
 * their own toned dot. The asymmetry lives in `StatusPill`; this only says the
 * rule applies here.
 *
 * The status and reason read as one value, `False · MinimumReplicasUnavailable`,
 * with an em dash standing in when there is no reason — an empty half of a
 * two-part value reads as a rendering fault. The last-transition time the old
 * table carried is gone: the design has no column for it, and the block is
 * read for what the object is complaining about, not when it started.
 *
 * An object reporting no conditions renders nothing at all — not an empty
 * block, which would still draw its own rule against the block below it.
 */
export function ConditionsSection({ conditions }: ConditionsSectionProps) {
  if (conditions.length === 0) return null;
  return (
    <Section title="Conditions">
      {conditions.map((condition) => (
        <KV
          key={condition.type}
          k={<StatusPill status={condition.type} kind={conditionKind(condition)} tinted />}
          v={`${condition.status} · ${condition.reason || "—"}`}
        />
      ))}
    </Section>
  );
}
