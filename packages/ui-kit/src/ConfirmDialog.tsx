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
const stack: symbol[] = [];

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    // While busy every control is disabled, so there may be nothing to focus;
    // the dialog itself takes it, which still announces the title.
    (first ?? dialogRef.current)?.focus();
    return () => {
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
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    stack.push(token.current);
    function onKeyDown(event: KeyboardEvent) {
      // Only the topmost dialog answers, whatever its own state.
      if (stack[stack.length - 1] !== token.current) return;
      if (event.key === "Escape") {
        if (busyRef.current) return;
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (focusable.length === 0) {
        // Nothing to move to; keep focus here rather than letting it escape.
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Wrapping is the trap: without it Tab from the last control lands on the
      // browser chrome and then the page behind.
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!dialogRef.current?.contains(active as Node)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const at = stack.indexOf(token.current);
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
        <div className="card-head">
          <div className="card-title" id={titleId}>
            {title}
          </div>
        </div>
        <div className="section-body text-[0.8125rem] text-muted" id={messageId}>
          {message}
        </div>
        <div className="card-head flex justify-end gap-2">
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
