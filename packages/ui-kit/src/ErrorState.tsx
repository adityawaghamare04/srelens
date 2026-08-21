import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

export interface ErrorStateProps {
  title: ReactNode;
  detail?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** An optional secondary action (e.g. "Diagnose in Toolbox"). */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * What a content area shows when its load failed: what went wrong, the detail
 * that makes it actionable, and a way out of it.
 *
 * It is an `alert` rather than a plain card because a failure arrives unbidden
 * — the user asked for pods and got this instead — and a live region is the
 * only thing that says so to a screen reader. That is also why it stays a
 * separate component from the loaded-but-empty and still-fetching cards rather
 * than a `tone` on one of them: the three differ in what they announce, not
 * just in how they look.
 *
 * The classic version took its glyph from lucide and its colour from
 * `--fl-color-danger`; the kit depends on no icon set, and the new design
 * spells severity `--sev`. (#318)
 */
export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = "Retry",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx(
        "card mx-auto flex max-w-[460px] flex-col items-center gap-2 p-6 text-center",
        className,
      )}
    >
      {/* Inline rather than an icon-set import: the kit takes no dependency
          on lucide, and this is the only glyph it needs. */}
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ color: "var(--sev)" }}
      >
        <path
          d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M12 9v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <strong className="text-[0.875rem]">{title}</strong>
      {detail != null && (
        <p data-slot="detail" className="text-[0.8125rem] leading-relaxed text-muted">
          {detail}
        </p>
      )}
      {(onRetry || action) && (
        <div data-slot="actions" className="flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
          {action && (
            <Button variant="secondary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
