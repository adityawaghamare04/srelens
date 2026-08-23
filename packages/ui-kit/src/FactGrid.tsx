import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

export interface FactGridProps {
  /** How many columns of facts to read across. The design draws three. */
  columns?: number;
  /** A run of {@link Section}s — the very body a narrow surface reads down. */
  children: ReactNode;
  className?: string;
}

/**
 * A detail body laid out for a page instead of a column: its fact rows become
 * columns of label-above-value pairs, each pair ruled off beneath.
 *
 * A WRAPPER rather than a different row component, and that is the whole
 * design of it. The same subject is drawn twice in this app — once in a peek a
 * few hundred pixels wide, once in a tab that fills the window — and the facts
 * on show are identical. If the two layouts were two components, the facts
 * would be derived twice, and this codebase has already found the same
 * derivation living in as many as six places. So the body is built once, by
 * whoever knows the subject, and the surface it lands on says how it should
 * read.
 *
 * `--fact-cols` rather than a class per count: a class the stylesheet has to
 * enumerate is a class that does not exist for the count nobody thought of.
 *
 * Everything that is not a fact row — the section's heading, a table, a list —
 * takes the full width. A three-column grid is a layout for pairs, and a table
 * squeezed into a third of one is not a narrower table, it is an unreadable
 * one.
 *
 * Every rule is scoped under `.factgrid`. The peek renders the very same rows
 * through the very same components and must be untouched by this existing.
 */
export function FactGrid({ columns = 3, children, className }: FactGridProps) {
  return (
    <div
      className={cx("factgrid", className)}
      // A custom property is not a colour and not a size the tokens own — it
      // is the count the caller asked for, which no token could know.
      style={{ "--fact-cols": columns } as CSSProperties}
    >
      {children}
    </div>
  );
}
