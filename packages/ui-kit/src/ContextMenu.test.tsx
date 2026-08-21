import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

// jsdom has no ResizeObserver, and Radix's popper watches the trigger and the
// content with one. The kit's shared setup does not stub it, and that setup is
// not this file's to edit, so the stub lives here. Inert: jsdom does no layout,
// so there is never a resize to report. (ColumnPicker.test.tsx carries the same
// stub, as does apps/desktop's setup.)
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

function Trash({ className }: { className?: string }) {
  return (
    <svg data-testid="trash" className={className} viewBox="0 0 24 24">
      <path d="M4 7h16" />
    </svg>
  );
}

const ITEMS: ContextMenuItem[] = [
  { label: "Duplicate tab", onPick: () => {} },
  { label: "Pin tab", onPick: () => {} },
  { kind: "sep" },
  { label: "Close tab", hint: "⌘W", onPick: () => {} },
  { label: "Close all tabs", icon: Trash, danger: true, onPick: () => {} },
];

function setup(props: Partial<Parameters<typeof ContextMenu>[0]> = {}) {
  return render(
    <ContextMenu items={ITEMS} label="Tab actions" {...props}>
      <button type="button">checkout-api</button>
    </ContextMenu>,
  );
}

const region = () => screen.getByText("checkout-api");

async function open(props: Partial<Parameters<typeof ContextMenu>[0]> = {}) {
  const view = setup(props);
  fireEvent.contextMenu(region());
  await screen.findByRole("menu");
  return view;
}

/**
 * What this component owns: the item vocabulary it accepts, how each kind of
 * item is drawn, what a pick reports back, and its wiring to Radix's
 * ContextMenu.
 *
 * Deliberately absent: roving focus, typeahead, outside-click dismissal and
 * collision-aware placement. Those are the library's — the mock hand-wrote a
 * fraction of them and got the fraction wrong, which is the whole reason this
 * wraps Radix. Asserting a dependency's internals through our component pins
 * the version we happen to have rather than the behaviour we promise. Escape is
 * here because losing it would be a real regression for the one user who has no
 * other way out. (#320)
 */
describe("ContextMenu", () => {
  it("shows the region it guards and nothing else until asked", () => {
    setup();
    expect(region()).toBeDefined();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on a right-click on that region", async () => {
    await open();
    expect(screen.getByRole("menu")).toBeDefined();
  });

  it("lists the items in the order given", async () => {
    await open();
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).toEqual(["Duplicate tab", "Pin tab", "Close tab⌘W", "Close all tabs"]);
  });

  it("reports the pick and closes", async () => {
    const onPick = vi.fn();
    await open({ items: [{ label: "Duplicate tab", onPick }] });
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate tab" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("draws a separator that is not itself an item", async () => {
    await open();
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(4);
  });

  it("tells the caller when it opens and closes", async () => {
    const onOpenChange = vi.fn();
    await open({ onOpenChange });
    expect(onOpenChange).toHaveBeenCalledWith(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("closes on Escape", async () => {
    await open();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});

/**
 * The mock drew a bare `<div>` of `<button>`s: no role, no name, no portal, and
 * a shortcut hint swallowed into every item's accessible name. Each of those is
 * corrected here.
 */
describe("ContextMenu announces itself", () => {
  it("carries the name it was given", async () => {
    await open();
    expect(screen.getByRole("menu", { name: "Tab actions" })).toBeDefined();
  });

  it("keeps the shortcut visible but out of the item's name", async () => {
    // The hint is a reminder of the keystroke, not part of what the item is
    // called; folded into the name it becomes "Close tab command W", which is
    // neither what the item does nor what a speech-input user would say.
    await open();
    const item = screen.getByRole("menuitem", { name: "Close tab" });
    expect(within(item).getByText("⌘W")).toBeDefined();
  });

  it("treats icons as decoration", async () => {
    // Hidden by the slot around it rather than by asking the icon to hide
    // itself: the icon is the caller's component, and one that quietly drops
    // the `aria-hidden` it is handed would put a nameless graphic inside the
    // item's name. The slot is ours, so the guarantee is ours.
    await open();
    const item = screen.getByRole("menuitem", { name: "Close all tabs" });
    expect(within(item).getByTestId("trash").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("holds the icon column open for items without one", async () => {
    // The design lines the labels up in a column. An icon that appears only on
    // some items shoves the rest sideways, so the space is always taken.
    await open();
    const withIcon = screen.getByRole("menuitem", { name: "Close all tabs" });
    const without = screen.getByRole("menuitem", { name: "Duplicate tab" });
    expect(within(withIcon).getByTestId("trash")).toBeDefined();
    expect(without.querySelector("[data-icon-slot]")).not.toBeNull();
  });

  it("marks a destructive item for the stylesheet without leaning on the tint", async () => {
    // `.ctx-item[data-danger]` turns the row red. The label is what says it is
    // destructive; the colour is a second channel over words that already
    // carry the meaning.
    await open();
    const item = screen.getByRole("menuitem", { name: "Close all tabs" });
    expect(item.getAttribute("data-danger")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Duplicate tab" }).getAttribute("data-danger")).toBeNull();
  });

  it("holds no control that could submit a surrounding form", async () => {
    // The mock's items were bare `<button>`s with no type, so a menu opened
    // over a row inside a form submitted it on the first pick. Radix's items
    // are not buttons at all; this pins that, and catches a future item that
    // reaches for one.
    await open();
    const menu = screen.getByRole("menu");
    expect(menu.querySelectorAll("button:not([type='button'])")).toHaveLength(0);
  });
});

describe("ContextMenu is wired to Radix correctly", () => {
  it("renders in a portal, outside the region it guards", async () => {
    const { container } = await open();
    expect(container.contains(screen.getByRole("menu"))).toBe(false);
  });

  it("moves focus into the menu", async () => {
    await open();
    expect(screen.getByRole("menu").contains(document.activeElement)).toBe(true);
  });

  it("keeps the design's own menu styling", async () => {
    await open();
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("ctx-menu");
    expect(screen.getByRole("menuitem", { name: "Duplicate tab" }).className).toContain("ctx-item");
  });

  it("overrides the stylesheet's fixed position so the collision box has a size", async () => {
    // `.ctx-menu` is written for a menu that places itself: `position: fixed`.
    // Radix already fixes and translates a wrapper around this content, and a
    // fixed child leaves that wrapper zero-sized — which is the box the
    // collision logic measures, so the menu would flip and shift against
    // nothing. Relative rather than static, so the stylesheet's z-index still
    // applies.
    await open();
    expect(screen.getByRole("menu").style.position).toBe("relative");
  });
});
