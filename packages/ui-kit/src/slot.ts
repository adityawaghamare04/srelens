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
 * Arrays are the other half of the same problem: `actions={items.map(...)}` is
 * how a slot is filled from a list, and an empty list hands over `[]`, which is
 * no more renderable than `false`. Checked through the array rather than on it,
 * so `[]`, `[false]` and a nested pair of those are all empty, while anything
 * with something in it is not.
 *
 * Zero survives: a count of 0 renders, and is usually the figure that matters
 * most. (#325 review)
 */
export function filled(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some((child) => filled(child));
  return node != null && node !== "" && typeof node !== "boolean";
}
