/**
 * The controls a user can actually reach inside a container, in the order the
 * browser will visit them.
 *
 * This exists as its own module because getting it wrong is the single most
 * productive source of bugs in the kit so far: ten review findings on #324, all
 * the same mistake in different clothes — a hidden input, a control under a
 * collapsed ancestor, a radio group counted member by member, a control
 * disabled by an ancestor fieldset, a native control with a negative tab index,
 * two forms sharing a radio name, an inert subtree, and positive tab indexes
 * out of DOM order.
 *
 * The mistake each time was treating "matches a selector" as "the browser will
 * stop here". The gap between those two is not cosmetic: a focus trap built on
 * the wrong list sits calling `focus()` on something that cannot take it, and
 * every Tab is cancelled while the user stays *outside* the dialog — the trap
 * running backwards.
 *
 * So this asks the DOM wherever the DOM has an answer, and it is shared rather
 * than copied, because Combobox, ColumnPicker and NamespaceMultiSelect need the
 * same list and three hand-written copies would drift apart one finding at a
 * time. (#324 review)
 */

/** Anything that could conceivably be a tab stop; the filter decides. */
const CANDIDATES = "a[href], button, input, select, textarea, [tabindex]";

/** `inert` makes a whole subtree unfocusable, and it is not a CSS property. */
function inert(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== root.parentElement; node = node.parentElement) {
    if (node.hasAttribute("inert")) return true;
  }
  return false;
}

/** `display` does not inherit, so an ancestor may hide a visible-looking control. */
function hiddenByAncestor(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== root.parentElement; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return true;
  }
  // `visibility` does inherit, so the control's own value settles it.
  return getComputedStyle(el).visibility === "hidden";
}

/**
 * One stop per radio group, where a group is (form owner, name) — two forms may
 * reuse a name and are then independent groups. The browser exposes the checked
 * member, or the first when none is checked.
 */
function isSupersededRadio(el: HTMLElement, root: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return false;
  const group = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
    (r) => r.name === el.name && r.form === el.form,
  );
  const stop = group.find((r) => r.checked) ?? group[0];
  return stop !== el;
}

export function tabbable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const found = [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter((el) => {
    // `:disabled` covers a fieldset disabling its descendants, which the
    // element's own `disabled` property does not report.
    if (el.matches(":disabled")) return false;
    // The effective value, whatever the tag — `:not([tabindex="-1"])` in a
    // selector only qualifies the branch it is attached to.
    if (el.tabIndex < 0) return false;
    if (el.hasAttribute("hidden") || el.closest("[hidden]")) return false;
    if (el instanceof HTMLInputElement && el.type === "hidden") return false;
    if (inert(el, root)) return false;
    if (hiddenByAncestor(el, root)) return false;
    if (isSupersededRadio(el, root)) return false;
    return true;
  });

  // Sequential tab order, not DOM order: positive tab indexes come first in
  // ascending order, then everything at 0 in DOM order. A trap that assumes DOM
  // order lets the browser's real first stop sit at a nonzero array index, and
  // Shift+Tab from it escapes.
  return found
    .map((el, index) => ({ el, index, order: el.tabIndex }))
    .sort((a, b) => {
      if (a.order === b.order) return a.index - b.index;
      if (a.order === 0) return 1;
      if (b.order === 0) return -1;
      return a.order - b.order;
    })
    .map((entry) => entry.el);
}
