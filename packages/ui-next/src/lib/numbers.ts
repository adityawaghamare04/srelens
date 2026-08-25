/**
 * Numbers as the design writes them.
 *
 * One rule, one place. `AppLog` and `Logs` each carried their own copy of the
 * grouping below, with the same comment on both — two functions that have to
 * stay identical for a buffer size to read the same on the screen you opened
 * it from as on the one you opened next.
 */

/**
 * Grouped the way the design writes numbers — a space every three digits.
 *
 * By hand rather than through `toLocaleString`, which would put a comma in it
 * under one locale and a full stop under another: `1,200` and `1.200` are the
 * same buffer to us and two different numbers to the readers of those
 * locales, and a log viewer's whole job is to be read literally.
 *
 * `\B` is what keeps the sign out of it — a word boundary DOES sit between `-`
 * and the first digit, so `\B` refuses that position and `-120` groups as
 * `-120` rather than `- 120`. `-1200` is the wrong example to reason from: its
 * leading group is one digit long, so the lookahead fails right after the sign
 * anyway and both spellings agree. The guard earns its keep exactly when the
 * leading group is three digits — `-120`, `-999`, `-120 000` — and, for the
 * same reason, at the head of a bare `999`.
 */
export function groupNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
