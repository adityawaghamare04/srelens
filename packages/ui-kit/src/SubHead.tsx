import type { ReactNode } from "react";
import { cx } from "./cx";

export interface SubHeadProps {
  children: ReactNode;
  className?: string;
}

/**
 * The bold line that labels a group inside a panel — Labels, Annotations,
 * Conditions, Containers — as distinct from the ruled bar that heads the panel
 * itself.
 *
 * An `h3`, not the mock's styled div. Every call site in the design names the
 * block beneath it, which is what a heading is; rendered as a div they are all
 * invisible to anyone reading the page by its outline, and that is the finding
 * `Panel`'s `h2` came from. The level is fixed for the same reason it is fixed
 * there: this sits inside a panel, so it is the level below one, and no group
 * in the design nests inside another. Preflight strips a heading's own size and
 * weight, so the utilities are what keep it looking like the mock's line rather
 * than a browser heading. (#320)
 */
export function SubHead({ children, className }: SubHeadProps) {
  return <h3 className={cx("text-[0.75rem] font-semibold", className)}>{children}</h3>;
}
