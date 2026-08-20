import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Spinner } from "./Spinner";

export interface ConfirmDialogProps {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Every open dialog, innermost last.
 *
 * Each instance listens on the document, so without this one Escape reached all
 * of them at once: two overlapping dialogs both cancelled, and a busy dialog on
 * top — whose own handler correctly declines — let the keypress fall through and
 * cancel the one hidden underneath it. Radix kept a layer stack for this; the
 * component is replacing that behaviour, so it has to keep one too.
 * (#324 review)
 */
type Layer = {
  token: symbol;
  el: () => HTMLElement | null;
  /** The live ref, so a closing layer can hand its opener on. */
  opener: { current: HTMLElement | null };
};
const stack: Layer[] = [];

/**
 * How many dialogs are holding the scroll lock, and what to put back.
 *
 * Per-instance snapshots leak when dialogs overlap and unmount out of order:
 * the lower one captures "", the upper captures "hidden", and if the lower
 * closes first it unlocks the page while the upper is still open — then the
 * upper restores the "hidden" it saw and the host stays locked forever. Only
 * the first lock records the original and only the last one restores it.
 * (#324 review)
 */
let locks = 0;
let lockedFrom: string | null = null;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The controls a user can actually reach, in order.
 *
 * Matching the selector is not enough. `<input type="hidden">` matched it and
 * cannot be focused, and since the message pane precedes the actions it sorted
 * first — so `focus()` was a no-op, initial focus stayed on the page behind,
 * and every Tab was cancelled while re-calling that no-op. The trap held the
 * user OUT of the dialog rather than in. The same goes for anything hidden or
 * display:none inside a caller's message. (#324 review)
 */
function tabbable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute("hidden") || el.closest("[hidden]")) return false;
    // `display` does not inherit, so asking the control alone says nothing
    // about an ancestor being hidden — a caller wrapping part of its message in
    // a collapsed container would leave an unfocusable control first in the
    // list, and the trap would sit there calling a no-op focus(). Walk up to
    // the dialog. `visibility` does inherit, so the control's own value is
    // enough for that one. (#324 review)
    for (let node: HTMLElement | null = el; node && node !== root.parentElement; node = node.parentElement) {
      if (getComputedStyle(node).display === "none") return false;
    }
    if (getComputedStyle(el).visibility === "hidden") return false;
    // A radio group is a single tab stop: the browser exposes only the checked
    // member, or the first when none is checked. Counting every radio put the
    // checked one at a nonzero index, so Shift+Tab was waved through while the
    // browser treated the group as the first stop — and focus left the modal.
    // (#324 review)
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      const group = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
        (r) => r.name === el.name,
      );
      const stop = group.find((r) => r.checked) ?? group[0];
      if (stop !== el) return false;
    }
    return true;
  });
}

/**
 * Modal confirmation dialog for destructive actions. Mounted only while open,
 * so dismissing — Escape, the overlay, Cancel — routes to `onCancel`.
 *
 * The classic version wrapped shadcn's Dialog and got the modal contract from
 * Radix. Under the kit's no-dependency rule every piece of it is written out
 * here, and none of it is decoration: a modal that does not trap focus lets Tab
 * walk into the page behind it, where a keyboard user can operate controls they
 * cannot see while a dialog claims to be blocking them. (#318)
 *
 * What Radix was doing, and is now done here:
 *
 *   - `role="dialog"` with `aria-modal`, named by its title and described by
 *     its message
 *   - focus moves in on open, to the first focusable control — Cancel, since it
 *     is first in the DOM, which is the safe default for a destructive prompt
 *   - Tab and Shift+Tab cycle within the dialog and never leave it
 *   - focus returns to whatever opened it on close
 *   - Escape and a click on the overlay cancel, but never while `busy`: the
 *     action is already in flight and dismissing would strand it
 *   - the page behind does not scroll
 *
 * `data-state="open"` is not cosmetic. Drawer looks for
 * `[role="dialog"][data-state="open"]` to decide that a layered modal owns the
 * first Escape; dropping the attribute would silently close both at once.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  // Read through a ref so the focus and key effects do not re-run — and so
  // re-tear-down the trap — every time the caller passes a new closure.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const token = useRef(Symbol("dialog"));

  // Focus in on open, and back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement;
    returnFocusTo.current = opener instanceof HTMLElement ? opener : null;
    const first = tabbable(dialogRef.current)[0];
    // While busy every control is disabled, so there may be nothing to focus;
    // the dialog itself takes it, which still announces the title.
    (first ?? dialogRef.current)?.focus();
    return () => {
      // Another dialog may still be on screen — either one opened over this
      // one, or one this was opened over. Focusing this dialog's opener would
      // put focus on a control behind a visible modal, outside the trap, where
      // the next Space or Enter activates something the user cannot see. Hand
      // focus to whatever layer is left instead. (#324 review)
      const others = stack.filter((l) => l.token !== token.current);
      if (others.length > 0) {
        const next = others[others.length - 1];
        // Hand the opener on as well. A dialog opened over this one recorded a
        // control *inside* this one as its opener, and that reference dies with
        // this unmount — so closing it later would fail the isConnected check
        // and drop focus on the body instead of the trigger the user came from.
        // (#324 review)
        const stale = !next.opener.current?.isConnected || dialogRef.current?.contains(next.opener.current);
        if (stale) next.opener.current = returnFocusTo.current;
        // If this dialog was opened from a control inside that layer, and the
        // control is still there, it is the user's actual position — the dialog
        // root is only a fallback for when it is not. (#324 review)
        const nextEl = next.el();
        const launcher = returnFocusTo.current;
        if (launcher?.isConnected && nextEl?.contains(launcher)) launcher.focus();
        else nextEl?.focus();
        return;
      }
      if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus();
    };
  }, []);

  // The page behind a modal must not scroll under it. Locking the body is not
  // enough on its own — this design already sets `body { overflow: hidden }`,
  // so the real scroller is whichever container the app puts inside it. The
  // overlay is portalled out to the body for that reason: as a fixed child of
  // the body it is no longer a descendant of any scroll container, so a wheel
  // over it has nothing to chain into. The body lock stays for hosts whose
  // body does scroll. (#324 review)
  useEffect(() => {
    if (locks === 0) lockedFrom = document.body.style.overflow;
    locks += 1;
    document.body.style.overflow = "hidden";
    return () => {
      locks -= 1;
      if (locks === 0) {
        document.body.style.overflow = lockedFrom ?? "";
        lockedFrom = null;
      }
    };
  }, []);

  useEffect(() => {
    stack.push({ token: token.current, el: () => dialogRef.current, opener: returnFocusTo });
    function onKeyDown(event: KeyboardEvent) {
      // Only the topmost dialog answers, whatever its own state.
      if (stack[stack.length - 1]?.token !== token.current) return;
      if (event.key === "Escape") {
        if (busyRef.current) return;
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = tabbable(dialogRef.current);
      if (focusable.length === 0) {
        // Nothing to move to; keep focus here rather than letting it escape.
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Index rather than identity checks. Focus can sit on something that is
      // inside the dialog but not in the tab order — the dialog root itself,
      // which is where it lands when the dialog opens while `busy` and every
      // control is disabled. Once `busy` clears, identity checks matched
      // neither end, so Shift+Tab fell through to the browser and walked into
      // the page behind the portal. -1 covers that and the outside case alike.
      // (#324 review)
      const at = focusable.indexOf(active as HTMLElement);
      // Wrapping is the trap: without it Tab from the last control lands on the
      // browser chrome and then the page behind.
      if (event.shiftKey ? at <= 0 : at === -1 || at === focusable.length - 1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const at = stack.findIndex((l) => l.token === token.current);
      if (at >= 0) stack.splice(at, 1);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "color-mix(in srgb, var(--canvas-deep) 72%, transparent)" }}
      onMouseDown={(event) => {
        // mousedown, not click: a drag that starts inside the dialog and ends
        // on the overlay would otherwise dismiss it mid-selection.
        if (event.target !== event.currentTarget) return;
        if (busy) return;
        onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-state="open"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="card rise flex max-h-full w-full flex-col overflow-hidden outline-none"
        style={{ maxWidth: 448 }}
      >
        <div className="card-head shrink-0">
          <div className="card-title" id={titleId}>
            {title}
          </div>
        </div>
        {/* The card is capped at max-h-full and clips, so a long message — a
            manifest preview, a stack of validation errors — used to push the
            actions outside the clipped area with no way to reach them. The
            message scrolls; the head and the actions do not shrink.
            (#324 review) */}
        <div
          className="section-body min-h-0 flex-1 overflow-y-auto text-[0.8125rem] text-muted"
          id={messageId}
        >
          {message}
        </div>
        <div className="card-head flex shrink-0 justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner label="Working" /> : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
