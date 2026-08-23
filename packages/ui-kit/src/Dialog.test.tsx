import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Dialog } from "./Dialog";

function setup(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onClose = vi.fn();
  const view = render(
    <Dialog title="Customise kind-local" onClose={onClose} footer={<button type="button">Done</button>} {...props}>
      <label>
        Display name
        <input />
      </label>
    </Dialog>,
  );
  return { onClose, ...view };
}

/**
 * What this component owns: the frame around a compact modal — its name, its
 * title, the way out of it, and where the caller's controls sit.
 *
 * Deliberately absent: the focus trap, the scroll lock and the layering. Those
 * are Radix's, for the reason {@link ConfirmDialog} sets out at length.
 * Escape and the returned focus are asserted here because both are seams this
 * component holds itself — it is mounted only while open, so there is no
 * `Dialog.Trigger` for Radix to hand focus back to.
 */
describe("Dialog", () => {
  it("is a modal named by its title", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Customise kind-local" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("shows the body and the footer it was given", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Display name/)).toBeDefined();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeDefined();
  });

  it("closes on the header's own control", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", async () => {
    const { onClose } = setup();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("moves focus into itself, and hands it back to whatever opened it", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = setup();
    await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));

    unmount();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it("renders in a portal, outside the tree that mounted it", () => {
    const { container } = setup();
    expect(container.contains(screen.getByRole("dialog"))).toBe(false);
  });

  it("draws no footer rule when the caller offers no controls", () => {
    setup({ footer: undefined });
    expect(screen.getByRole("dialog").querySelector("[data-slot='dialog-footer']")).toBeNull();
  });
});
