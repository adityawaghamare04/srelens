import { cx } from "./cx";

export interface PairListProps {
  pairs: Array<[key: string, value: string]>;
  /** Let a long value wrap over several lines instead of truncating it. */
  breakValues?: boolean;
  className?: string;
}

/**
 * Labels and annotations, printed as `key=value` the way kubectl prints them —
 * the form anyone who has run `describe` already reads without thinking.
 *
 * A `ul` of `li`, not a stack of divs: this is a set, and how many are in it is
 * part of reading it — an annotation block is scanned for what is there as much
 * as for what it says. Each row truncates by default, because the block is
 * scanned by key and a value wrapping over four lines buries the next one;
 * `breakValues` is for the pane wide enough to show one in full. The whole pair
 * hangs off the row as a title either way, since the truncated row is the one
 * that most needs reading. An empty set renders nothing rather than an empty
 * `.pairs`, whose line height would leave a gap between the two blocks it sits
 * between. (#320)
 */
export function PairList({ pairs, breakValues, className }: PairListProps) {
  if (pairs.length === 0) return null;
  return (
    <ul className={cx("pairs", className)}>
      {pairs.map(([k, v]) => (
        <li key={k} className={breakValues ? undefined : "truncate"} title={`${k}=${v}`}>
          <span className="k">{k}=</span>
          <span className={cx("v", breakValues && "break-all")}>{v}</span>
        </li>
      ))}
    </ul>
  );
}
