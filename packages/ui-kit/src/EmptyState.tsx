import type { ReactNode } from "react";
import { cx } from "./cx";
import { filled } from "./slot";

export interface EmptyStateProps {
  title: ReactNode;
  /** One line of context under the title: why it is empty, or what fills it. */
  hint?: ReactNode;
  /** A control the caller owns — usually the button that ends the emptiness. */
  action?: ReactNode;
  className?: string;
}

/**
 * The placeholder for a list or panel that loaded successfully and has nothing
 * in it — the settled counterpart to `LoadingState`, which speaks for a load
 * still in flight.
 *
 * The classic version offered a title and a description, which left every
 * caller with an empty list and no way out of it; the design's shape adds an
 * `action` slot, and takes a node rather than a label and a handler so the
 * caller's own button arrives with its variant, its disabled state and its
 * confirmation intact. The hint is capped at 42ch because a centred column of
 * prose stops being readable long before it reaches the width of a table.
 *
 * It stays silent to assistive technology: this is the resting state of a
 * region the reader navigated to, not an event worth announcing. (#318)
 */
export function EmptyState({ title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="text-[0.875rem] font-medium">{title}</div>
      {filled(hint) && (
        <div data-slot="hint" className="max-w-[42ch] text-[0.8125rem] leading-relaxed text-muted">
          {hint}
        </div>
      )}
      {filled(action) && (
        <div data-slot="action" className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}
