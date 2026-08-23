import { ActionBar, Button, type ActionBarAction, type ContextMenuItem } from "@srelens/ui-kit";
import { useConsole } from "../../console";
import { Icons } from "../../lib/icons";
import { askQuestion } from "../../lib/kinds/rowAffordances";
import { ROW_ACTION_LABEL } from "../../lib/kinds/rowActions";
import type { KindActions, ListRow } from "../../lib/kinds/types";
import { useRowMenu } from "../ResourceMenu";

/**
 * How many of the kind's own actions stay on the bar before the rest fold into
 * the overflow.
 *
 * Two, because the design draws two — `Logs` and then `Edit` on a Deployment,
 * `Logs` and then `Shell` on a Pod — and because the bar shares a pane that is
 * 260px wide at its narrowest. It is not a per-kind choice: the row menu's own
 * order puts the read-only affordances first and the destructive group last, so
 * taking the first two is what produces the design's pair for every kind
 * without anything here naming one.
 */
const ON_BAR = 2;

/**
 * The shorter words the design puts on the bar, for the three entries whose
 * menu labels carry a verb the bar has no room for.
 *
 * Only these three, and only on the bar: the menu is a menu and can afford
 * "Follow logs". Keyed through {@link ROW_ACTION_LABEL} rather than spelt out,
 * so renaming an entry in the row menu is a type error here rather than a
 * silent reversion to the long label.
 */
const BAR_LABEL: Record<string, string> = {
  [ROW_ACTION_LABEL.logs]: "Logs",
  [ROW_ACTION_LABEL.shell]: "Shell",
  [ROW_ACTION_LABEL.forward]: "Forward",
};

/**
 * The row menu's entries, as bar actions.
 *
 * `ContextMenuItem` and `ActionBarAction` describe the same thing in two
 * vocabularies — `onPick`/`onSelect`, and an `id` the menu does not need
 * because a menu row is identified by what it says. So the label IS the id,
 * which is sound because `useRowMenu` never emits the same label twice in one
 * list. Separators go: a bar has no rows to divide, and `ActionBar` already
 * draws the destructive ones in the danger tone from `danger` alone.
 *
 * "Open in new tab" is the one entry dropped. In the peek the header already
 * carries "Open tab" (the design draws it there, outlined, beside the close),
 * and in the full tab host the pane IS the tab — an entry that opens a second
 * copy of what you are looking at.
 */
function toBarActions(items: ContextMenuItem[]): ActionBarAction[] {
  const actions: ActionBarAction[] = [];
  for (const item of items) {
    if (item.kind === "sep" || item.label === ROW_ACTION_LABEL.openTab) continue;
    actions.push({
      id: item.label,
      label: BAR_LABEL[item.label] ?? item.label,
      icon: item.icon,
      danger: item.danger,
      onSelect: item.onPick,
    });
  }
  return actions;
}

export interface DetailFooterProps {
  context: string;
  kind: string;
  namespace: string | null;
  name: string;
  /**
   * Which actions this kind offers, off its `KindDescriptor` — the same table
   * the list's row menu reads. The design's per-kind middle pair falls out of
   * it; nothing here branches on a kind's name.
   */
  actions: KindActions;
  /**
   * The subject's own health verdict, which decides which question `Ask`
   * sends. From `resourceStatusLine`, the same read the header's dot uses.
   */
  flagged: boolean;
  /** CronJob only: `spec.suspend`, so Suspend/Resume is labelled the right way
   *  round. `useRowMenu` reads it off the row, as it does for a list. */
  suspended?: boolean;
}

/**
 * The design's footer: a wide `Ask`, the kind's own actions, an overflow.
 *
 * Every action in it is the list's row menu, unchanged — `useRowMenu` already
 * owns Follow logs, Open shell, Port forward, Edit, Copy as kubectl,
 * Suspend/Resume, Run now, Scale, Restart rollout, Evict and Delete, along
 * with the confirm each destructive one takes and the kubectl preview inside
 * it. A second implementation of that list is the thing this file exists to
 * avoid: it renders the hook's `dialog` as well as its items, so a Delete in
 * the overflow reaches the very confirm a Delete in the row menu does.
 *
 * Two adaptations, and only two. The hook is typed on `ListRow` — the shape a
 * table hands it — while this pane holds a `K8sObject`, so the row is
 * reconstituted from the identity the pane already has. And it answers in
 * `ContextMenuItem`s, which {@link toBarActions} projects onto `ActionBar`'s
 * vocabulary.
 *
 * `Ask` is a `Button` rather than the row's `AskChip`: the chip is
 * `opacity: 0` until its row is hovered, which is right for one of forty rows
 * and wrong for the only control on a bar. The question itself is the chip's,
 * through {@link askQuestion} — one phrasing per gesture, wherever it is
 * drawn.
 */
export function DetailFooter({ context, kind, namespace, name, actions, flagged, suspended }: DetailFooterProps) {
  const { ask } = useConsole();
  const { items, dialog } = useRowMenu({ context, kind, actions });

  // What a table would have handed the hook. `suspended` is not on `ListRow`
  // — `useRowMenu` reads it off the row with the same cast a `CronJobSummary`
  // needs — so it rides along the same way.
  const row: ListRow & { suspended?: boolean } = {
    name,
    ...(namespace === null ? {} : { namespace }),
    ...(suspended === undefined ? {} : { suspended }),
  };
  const question = askQuestion(name, flagged);
  const Sparkle = Icons.ask;

  return (
    <>
      {/* Wide, per the design: it takes whatever the kind's own actions leave.
          The visible word is short and the same on every subject, so the
          question goes in the accessible name, where it says what will
          actually be sent — the same split `AskChip` makes. */}
      <Button
        type="button"
        size="sm"
        className="flex-1 justify-center"
        aria-label={`Ask: ${question}`}
        title={`Ask: ${question}`}
        onClick={() => ask(question)}
      >
        <Sparkle size={12} aria-hidden="true" />
        Ask
      </Button>
      <ActionBar actions={toBarActions(items(row))} label={`${kind} actions`} max={ON_BAR} />
      {dialog}
    </>
  );
}
