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

describe("ConfirmDialog closing out of order", () => {
  function stackTwo() {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const lower = render(
      <ConfirmDialog title="lower" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const upper = render(
      <ConfirmDialog title="upper" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    return { opener, lower, upper };
  }

  it("does not put focus behind a dialog that is still open", () => {
    // The lower dialog closing used to focus its own opener — a control behind
    // a visible modal, outside the trap, where the next Space or Enter
    // activates something the user cannot see. (#324 review)
    const { opener, lower } = stackTwo();
    lower.unmount();
    expect(document.activeElement).not.toBe(opener);
    expect(document.body.contains(document.activeElement)).toBe(true);
    opener.remove();
  });

  it("hands focus back to the control that opened the top dialog", () => {
    // This asserted the dialog *root* until #324 review pointed out that the
    // saved opener is the user's actual position when it is still connected
    // and belongs to the remaining layer. The root is the fallback, below.
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const lower = render(
      <ConfirmDialog title="lower" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    // Captured between the renders: this is what had focus when the upper
    // dialog mounted, so it is the upper's saved opener.
    const launcher = document.activeElement as HTMLElement;
    const remaining = screen.getByRole("dialog", { name: "lower" });
    expect(remaining.contains(launcher), "the upper was opened from the lower").toBe(true);

    const upper = render(
      <ConfirmDialog title="upper" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    upper.unmount();
    expect(document.activeElement).toBe(launcher);
    lower.unmount();
    opener.remove();
  });

  it("falls back to the dialog root when the opener is not in that layer", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const lower = render(
      <ConfirmDialog title="lower" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    // Focus somewhere unrelated before the upper opens, so its saved opener
    // does not belong to the lower dialog.
    (document.activeElement as HTMLElement)?.blur();
    const upper = render(
      <ConfirmDialog title="upper" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    upper.unmount();
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "lower" }));
    lower.unmount();
    opener.remove();
  });

  it("returns to the opener once the last dialog closes", () => {
    const { opener, lower, upper } = stackTwo();
    upper.unmount();
    lower.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("ConfirmDialog with tall content", () => {
  it("scrolls the message and keeps the actions in place", () => {
    // The card is capped at max-h-full and clips. Without an internal scroll
    // region a long message — a manifest preview, a stack of validation
    // errors — pushes Confirm and Cancel outside the clipped area with no way
    // to reach them. Asserted structurally: jsdom does no layout, so there is
    // no height to measure. (#324 review)
    render(
      <ConfirmDialog
        title="Apply?"
        message={"a very long explanation. ".repeat(200)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const message = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(message?.className).toContain("overflow-y-auto");
    expect(message?.className).toContain("min-h-0");

    const actions = screen.getByRole("button", { name: "Cancel" }).parentElement;
    expect(actions?.className, "the action row must not shrink away").toContain("shrink-0");
  });
});

describe("ConfirmDialog with non-tabbable controls in the message", () => {
  it("enters the dialog even when the message hides an input", async () => {
    // `input:not([disabled])` matches <input type="hidden">, which browsers
    // cannot focus. It sorted first because the message precedes the actions,
    // so focus() was a no-op: initial focus stayed on the page behind, and each
    // Tab was preventDefault'd while re-calling that no-op — trapping the user
    // OUT of the dialog rather than in. (#324 review)
    render(
      <ConfirmDialog
        title="Apply?"
        message={
          <form>
            <input type="hidden" name="token" value="x" readOnly />
            details
          </form>
        }
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.tab();
    expect(dialog.contains(document.activeElement), "Tab must stay inside").toBe(true);
  });

  it("skips a hidden control when cycling", async () => {
    render(
      <ConfirmDialog
        title="Apply?"
        message={<input type="hidden" name="token" value="x" readOnly />}
        confirmLabel="Apply"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });
});

describe("ConfirmDialog opener chain", () => {
  it("returns to the original trigger after the lower dialog closes first", () => {
    // The upper dialog's opener is a control inside the lower one, so once the
    // lower unmounts that reference is disconnected: the isConnected check
    // fails and focus lands on the body instead of the trigger the user came
    // from. Closing lower-first then upper is the sequence that exposes it.
    // (#324 review)
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const lower = render(
      <ConfirmDialog title="lower" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const upper = render(
      <ConfirmDialog title="upper" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );

    lower.unmount();
    upper.unmount();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("ConfirmDialog with a control under a hidden ancestor", () => {
  it("does not try to focus a control inside a display:none wrapper", async () => {
    // `display` does not inherit, so getComputedStyle on the control reports
    // its own value and says nothing about an ancestor being hidden. Such a
    // control cannot be focused, and since it precedes the actions the trap
    // would keep re-calling a no-op focus() — holding the user outside the
    // dialog again, one layer deeper than the hidden-input case. (#324 review)
    render(
      <ConfirmDialog
        title="Apply?"
        message={
          <div style={{ display: "none" }}>
            <button type="button">ghost</button>
          </div>
        }
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.tab();
    expect(dialog.contains(document.activeElement), "Tab must stay inside").toBe(true);
    expect(document.activeElement).not.toBe(screen.getByText("ghost"));
  });
});

describe("ConfirmDialog nested flows", () => {
  it("returns to the control that opened the top dialog, not the dialog root", () => {
    // The upper dialog was opened from a control inside the lower one, and that
    // control is still connected — it is the user's actual position. Focusing
    // the lower dialog's root instead loses it. (#324 review)
    const lower = render(
      <ConfirmDialog title="lower" message="m" confirmLabel="Go on" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const launcher = screen.getByRole("button", { name: "Go on" });
    launcher.focus();

    const upper = render(
      <ConfirmDialog title="upper" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    upper.unmount();

    expect(document.activeElement).toBe(launcher);
    lower.unmount();
  });
});

describe("ConfirmDialog with a radio group in the message", () => {
  it("treats the group as one tab stop", async () => {
    // The browser exposes only the checked radio as the group's sequential tab
    // stop. Counting every enabled radio put the checked one at a nonzero
    // index, so Shift+Tab was allowed through while the browser treated the
    // group as the first stop — and focus left the modal. (#324 review)
    render(
      <ConfirmDialog
        title="Pick one"
        message={
          <fieldset>
            <label>
              <input type="radio" name="scope" value="a" /> a
            </label>
            <label>
              <input type="radio" name="scope" value="b" defaultChecked /> b
            </label>
          </fieldset>
        }
        confirmLabel="Apply"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const checked = screen.getByRole("radio", { name: "b" }) as HTMLInputElement;
    checked.focus();
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement), "Shift+Tab must stay inside").toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));
  });
});

describe("ConfirmDialog with three layers", () => {
  it("returns to the original trigger however the stack unwinds", () => {
    // Bottom closing repaired only the top layer. The top's opener was still
    // connected inside the middle, so nothing propagated — and when the middle
    // then closed it handed the top an opener from the already-gone bottom.
    // Closing the top then failed isConnected and dropped focus on the body.
    // (#324 review)
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const bottom = render(
      <ConfirmDialog title="bottom" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const middle = render(
      <ConfirmDialog title="middle" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const top = render(
      <ConfirmDialog title="top" message="m" onConfirm={() => {}} onCancel={() => {}} />,
    );

    bottom.unmount();
    middle.unmount();
    top.unmount();

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

/**
 * The sixth, seventh and eighth findings in `tabbable`, all the same root
 * mistake: approximating what the browser considers a tab stop instead of
 * asking it. (#324 review)
 */
describe("ConfirmDialog tab stops match the browser's", () => {
  it("skips a control disabled by an ancestor fieldset", async () => {
    // The control carries no disabled attribute of its own, but the browser
    // treats it as disabled, so focus() is a no-op and the trap sits on it.
    render(
      <ConfirmDialog
        title="t"
        message={
          <fieldset disabled>
            <button type="button">ghost</button>
          </fieldset>
        }
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("skips a native control with a negative tab index", async () => {
    // :not([tabindex="-1"]) only qualified the generic branch, so a button or
    // input with tabIndex={-1} was still counted — putting Cancel at a nonzero
    // index, so Shift+Tab was waved through while the browser skipped the
    // negative control and left the modal.
    render(
      <ConfirmDialog
        title="t"
        message={
          <button type="button" tabIndex={-1}>
            skipme
          </button>
        }
        confirmLabel="Apply"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement), "must stay inside").toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Apply" }));
  });

  it("treats same-named radios in different forms as different groups", async () => {
    // Two forms reusing a name are independent groups. Merging them by name
    // dropped the second form's checked radio from the list entirely, so the
    // browser could focus something the trap did not know about.
    render(
      <ConfirmDialog
        title="t"
        message={
          <>
            <form>
              <input type="radio" name="scope" aria-label="one" defaultChecked />
            </form>
            <form>
              <input type="radio" name="scope" aria-label="two" defaultChecked />
            </form>
          </>
        }
        confirmLabel="Apply"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const two = screen.getByRole("radio", { name: "two" });
    two.focus();
    await userEvent.tab();
    // The second form's radio is a real stop, so Tab from it reaches Cancel.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });
});
