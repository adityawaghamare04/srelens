import { useRef, type ReactNode } from "react";
import { Dialog as Modal } from "radix-ui";
import { cx } from "./cx";

export interface DialogProps {
  /** Names the dialog, and is drawn as its heading. */
  title: ReactNode;
  children: ReactNode;
  /** Escape, the overlay, and the header's own control all arrive here. */
  onClose: () => void;
  /** The controls along the bottom edge. Left out, there is no footer at all. */
  footer?: ReactNode;
  /** How wide the card may grow, in px. */
  maxWidth?: number;
  /** Names the header's control, for a design that would rather say "Cancel". */
  closeLabel?: string;
  className?: string;
}

/**
 * A compact modal with a title, a body and a row of controls: the frame around
 * one small task — customise this, rename that — that is too much for a popover
 * and too little for a screen.
 *
 * {@link ConfirmDialog} is the same frame with the task written into it, and
 * this is deliberately not a refactor of it: that component's contract is a
 * question and two answers, with `busy` blocking every way out while the answer
 * is in flight, and folding it into a generic shell would put a `message`,
 * a `confirmLabel` and a `busy` on every dialog that has none of them. What the
 * two do share is the Radix reasoning — the focus trap, the portal, the scroll
 * lock, the layering and the ARIA wiring are library-sized problems that the
 * hand-written version of that component drew twenty-two review findings for.
 *
 * The two seams Radix leaves open for a dialog mounted only while open are
 * handled the way ConfirmDialog handles them, and for the same reason: there is
 * no `Dialog.Trigger` to render, because whoever decided to open this is
 * somewhere else in the app, so the opener is captured on the way in and
 * focused again on the way out. (#325)
 */
export function Dialog({ title, children, onClose, footer, maxWidth = 420, closeLabel = "Close", className }: DialogProps) {
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <Modal.Portal>
        <Modal.Overlay
          data-slot="dialog-overlay"
          className="fixed inset-0 z-50"
          style={{ background: "color-mix(in srgb, var(--canvas-deep) 72%, transparent)" }}
        />
        <Modal.Content
          data-slot="dialog-content"
          // Radix isolates the background with aria-hidden, which is stronger
          // than aria-modal — it removes the page from the accessibility tree
          // rather than asking for it to be ignored. aria-modal is set anyway:
          // it costs nothing and is what older assistive technology looks for.
          aria-modal="true"
          // The body is the caller's, so there is nothing here that reliably
          // describes the dialog. Left undefined rather than pointed at the
          // whole body, which Radix would otherwise read out entire.
          aria-describedby={undefined}
          className={cx(
            "card rise fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100%-3rem)] w-[calc(100%-3rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden outline-none",
            className,
          )}
          style={{ maxWidth }}
          // Radix returns focus to `Dialog.Trigger` on close and there is none
          // here. Its own fallback — whatever was focused before the dialog
          // mounted — is the right one, but the modal content cancels that
          // fallback in favour of the trigger it expects, so with no trigger
          // the opener never gets focus back. This hook fires before focus
          // moves in, so the opener is still the active element.
          onOpenAutoFocus={() => {
            const active = document.activeElement;
            openerRef.current = active instanceof HTMLElement ? active : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            // A dialog can outlive the control that opened it. Focusing a
            // detached node does nothing, so leave focus where it falls.
            if (opener?.isConnected) opener.focus();
          }}
        >
          <div className="card-head shrink-0">
            <Modal.Title className="card-title min-w-0 truncate">{title}</Modal.Title>
            <button type="button" aria-label={closeLabel} onClick={onClose} className="icon-btn shrink-0">
              {/* Inline rather than an icon-set import: the kit takes no
                  dependency on lucide, and this is the only glyph it needs. */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {/* The card is capped and clips, so a tall body — a palette, a long
              form — would push the controls out of view. The body scrolls; the
              head and the footer do not shrink. */}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer !== undefined && (
            <div data-slot="dialog-footer" className="card-head shrink-0 justify-end gap-2 border-b-0 border-t">
              {footer}
            </div>
          )}
        </Modal.Content>
      </Modal.Portal>
    </Modal.Root>
  );
}
