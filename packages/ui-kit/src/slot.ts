import type { ReactNode } from "react";

/**
 * Whether an optional slot has anything in it.
 *
 * `node != null` is not enough. `action={canCreate && <Button />}` is the
 * ordinary way to make a slot conditional, and it hands over `false` rather
 * than nothing. React renders no output for that, but a wrapper written around
 * it still takes its padding and its share of the parent's gap — so the caller
 * gets the band of empty space they were trying to avoid, and the component
 * that looked like it handled the case did not.
 *
 * Zero survives: a count of 0 renders, and is usually the figure that matters
 * most. (#325 review)
 */
export function filled(node: ReactNode): boolean {
  return node != null && node !== "" && typeof node !== "boolean";
}
