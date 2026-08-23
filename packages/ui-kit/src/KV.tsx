import type { ReactNode } from "react";
import { cx } from "./cx";

export interface KVProps {
  k: ReactNode;
  v: ReactNode;
  /** Set the value in the monospace face — for identifiers, not for prose. */
  mono?: boolean;
  className?: string;
}

/**
 * One key and its value, laid out as the fixed label column the detail panes
 * read down.
 *
 * A `dl` holding a `dt` and a `dd` rather than the mock's three divs: a key and
 * its value are a name/value group, and the markup that says so is the only
 * thing telling anyone listening to the page which half is which. The whole
 * group is carried here, one row per list, because a row is used on its own as
 * often as it is used through {@link KVList} — a `dt` with no `dl` around it is
 * markup a browser gives no meaning to, and no prop or convention can make a
 * caller remember the wrapper. (#320)
 *
 * `KV` used to take an explicit `title` for the value cell, and {@link KVList}
 * set one from every string value without being asked. Neither was standing
 * in for truncation: `.kv-v` wraps a long value onto another line rather than
 * cutting it off (`overflow-wrap: anywhere`, no `text-overflow`), so the
 * title was only ever a second, unredacted copy of the value sitting in the
 * DOM — the same disclosure hole `PairList` removed after a `kubectl
 * apply`-managed Secret leaked through it via an annotation. There is no prop
 * to put it back, for the same reason. (#331)
 */
export function KV({ k, v, mono, className }: KVProps) {
  return (
    <dl className={cx("kv", className)}>
      <dt className="kv-k">{k}</dt>
      <dd className={cx("kv-v", mono && "code")}>{v}</dd>
    </dl>
  );
}

export interface KVListProps {
  rows: Array<[key: string, value: ReactNode]>;
  /**
   * Which values are identifiers and should be set in the code face. Asked
   * only about values that are text — a node has nothing to test.
   */
  mono?: (value: string) => boolean;
}

/**
 * The rows of a detail pane, from the tuples a caller already has.
 *
 * No wrapper element, which is the one thing to keep: the rows are meant to
 * land as children of whatever laid the pane out, and a block between them and
 * a flex or grid parent quietly changes the layout of every pane that uses one.
 * That is also why the description list lives on the row rather than around the
 * group. No `className` for the same reason — there is no element of its own to
 * put one on. (#320)
 */
export function KVList({ rows, mono }: KVListProps) {
  return (
    <>
      {rows.map(([k, v]) => (
        <KV
          key={k}
          k={k}
          v={v}
          mono={typeof v === "string" && mono ? mono(v) : undefined}
        />
      ))}
    </>
  );
}
