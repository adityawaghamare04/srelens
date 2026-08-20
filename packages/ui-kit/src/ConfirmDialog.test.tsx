import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";

function open(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  return render(
    <ConfirmDialog
      title="Delete pod?"
      message="This cannot be undone."
      onConfirm={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );
}

/** The classic component's tests, carried over. (#318) */
describe("ConfirmDialog", () => {
  it("renders title/message and fires confirm and cancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Delete pod?"
        message="This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Delete pod?")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables buttons while busy", () => {
    open({ busy: true });
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/**
 * The modal contract Radix used to supply. A dialog that does not trap focus
 * lets Tab walk into the page behind it, where a keyboard user can operate
 * controls they cannot see while the dialog claims to be blocking them. (#318)
 */
describe("ConfirmDialog modal behaviour", () => {
  it("announces itself as a modal, named and described", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Delete pod?" })).toBeDefined();
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe("This cannot be undone.");
  });

  it("keeps the marker Drawer looks for", () => {
    // Drawer defers the first Escape to a layered modal by querying exactly
    // this selector. Dropping the attribute would close both at once.
    open();
    expect(document.querySelector('[role="dialog"][data-state="open"]')).not.toBeNull();
  });

  it("moves focus to Cancel when it opens", () => {
    // First in the DOM, and the safe default for a destructive prompt.
    open({ confirmLabel: "Delete", danger: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("cycles Tab within the dialog", async () => {
    open({ confirmLabel: "Delete" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab();
    expect(document.activeElement).toBe(confirm);
    // Wrapping is the trap: without it this lands outside the dialog.
    await userEvent.tab();
    expect(document.activeElement).toBe(cancel);
  });

  it("cycles Shift+Tab backwards within the dialog", async () => {
    open({ confirmLabel: "Delete" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("pulls focus back if it lands outside", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    try {
      open();
      outside.focus();
      // Backwards on purpose. Tabbing forward from a node that sits before the
      // dialog in the DOM reaches it anyway, so that direction proves nothing;
      // Shift+Tab is the direction that walks away from the dialog.
      await userEvent.tab({ shift: true });
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it("returns focus to whatever opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = open();
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    open({ onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while busy", () => {
    // The action is already in flight; dismissing would strand it.
    const onCancel = vi.fn();
    open({ busy: true, onCancel });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on a click on the overlay, but not inside the dialog", () => {
    const onCancel = vi.fn();
    open({ onCancel });
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores the overlay while busy", () => {
    const onCancel = vi.fn();
    open({ busy: true, onCancel });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as Element);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders outside any scroll container", () => {
    // Locking the body is not enough and this test used to check only that.
    // kit.css already sets `body { overflow: hidden }`, so the real scroller is
    // whichever container the app puts inside it — `.kit-gallery` in the
    // catalogue — and an overlay rendered inside that container still scrolls
    // it on a wheel. Portalled to the body it is a fixed element with no scroll
    // container to chain into. (#324 review)
    open();
    expect(screen.getByRole("dialog").parentElement?.parentElement).toBe(document.body);
  });

  it("locks the body too, for hosts whose body scrolls", () => {
    expect(document.body.style.overflow).toBe("");
    const { unmount } = open();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("still traps when every control is disabled", () => {
    // While busy there is nothing focusable inside; focus must stay on the
    // dialog rather than falling through to the page.
    open({ busy: true });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});

/**
 * Stacked dialogs. An application-level confirmation can appear over a local
 * one — an agent asking to run something while a delete prompt is open — and
 * each instance listens on the document. (#324 review)
 */
describe("ConfirmDialog stacking", () => {
  function two(topBusy = false) {
    const bottom = vi.fn();
    const top = vi.fn();
    const lower = render(
      <ConfirmDialog title="lower" message="m" onConfirm={() => {}} onCancel={bottom} />,
    );
    const upper = render(
      <ConfirmDialog title="upper" message="m" busy={topBusy} onConfirm={() => {}} onCancel={top} />,
    );
    return { bottom, top, lower, upper };
  }

  it("cancels only the topmost dialog", () => {
    const { bottom, top } = two();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });

  it("does not fall through to a hidden dialog when the top one is busy", () => {
    // The visible dialog declines Escape because its action is in flight. If
    // the keypress carried on, it would cancel something the user cannot see.
    const { bottom, top } = two(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(top).not.toHaveBeenCalled();
    expect(bottom).not.toHaveBeenCalled();
  });

  it("hands Escape back when the top one closes", () => {
    const { bottom, upper } = two();
    upper.unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bottom).toHaveBeenCalledTimes(1);
  });
});

/** Both found in review on #324, neither reachable by the tests that existed. */
describe("ConfirmDialog overlapping lifetimes", () => {
  it("keeps the scroll lock while any dialog is still open", () => {
    // Per-instance snapshots leak when dialogs unmount out of order: the lower
    // one restores "" while the upper is still open, and the upper then puts
    // back the "hidden" it captured, locking the host for good.
    expect(document.body.style.overflow).toBe("");
    const lower = render(
      <ConfirmDialog title="lower" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const upper = render(
      <ConfirmDialog title="upper" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(document.body.style.overflow).toBe("hidden");

    lower.unmount();
    expect(document.body.style.overflow, "still locked: a dialog is open").toBe("hidden");

    upper.unmount();
    expect(document.body.style.overflow, "restored once the last one closes").toBe("");
  });

  it("traps Shift+Tab once a busy dialog becomes interactive", async () => {
    // Opening while busy leaves focus on the dialog root, because every control
    // is disabled. When busy clears, the root is inside the dialog but not in
    // its tab order, so Shift+Tab used to fall through to the page behind.
    const { rerender } = render(
      <ConfirmDialog
        title="t"
        message="m"
        busy
        confirmLabel="Apply"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    rerender(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="Apply"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));
  });

  it("wraps forward from the dialog root too", async () => {
    const { rerender } = render(
      <ConfirmDialog title="t" message="m" busy onConfirm={() => {}} onCancel={() => {}} />,
    );
    rerender(<ConfirmDialog title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });
});
