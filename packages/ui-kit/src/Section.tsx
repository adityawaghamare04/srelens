import type { ReactNode } from "react";
import { SubHead } from "./SubHead";
import { cx } from "./cx";
import { filled } from "./slot";

export interface SectionProps {
  /**
   * The small bold line naming the block. Left off for the first block in a
   * run, which the design heads with nothing — the pane's own header has
   * already said what the subject is.
   */
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A flat block of content with an optional heading, divided from the block
 * before it by a hairline rule.
 *
 * The other shape beside `Panel`, not a flag on it. A panel is a card: a
 * lifted surface, a border all the way round and a ruled head in small caps,
 * which is right for a section of a page standing on its own. A detail body is
 * the opposite — one subject read top to bottom, its parts separated rather
 * than boxed — and stacking cards inside a 352px peek spends most of the width
 * on borders and leaves the eye four frames to cross instead of one column to
 * read. Both call sites exist, so both shapes do. (#331)
 *
 * The divider is a sibling rule (`.section + .section`), which is what makes a
 * run of these read as divided rather than framed: no line above the first, none
 * below the last, and a caller that renders a block conditionally gets the
 * right answer without counting. Nothing to pass, nothing to keep in sync.
 *
 * The heading is `SubHead` — an `h3`, so the blocks of a peek appear in the
 * document outline under the peek's own `h2`. That is the same finding
 * `Panel`'s heading came from: a styled div names a block for people who can
 * see it and for nobody else.
 */
export function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cx("section", className)}>
      {filled(title) && <SubHead className="section-title">{title}</SubHead>}
      {children}
    </section>
  );
}
