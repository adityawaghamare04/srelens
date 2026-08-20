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
    const { container } = open({ onCancel });
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.firstElementChild as Element);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores the overlay while busy", () => {
    const onCancel = vi.fn();
    const { container } = open({ busy: true, onCancel });
    fireEvent.mouseDown(container.firstElementChild as Element);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("stops the page behind from scrolling, and restores it", () => {
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
