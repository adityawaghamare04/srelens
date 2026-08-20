import { useEffect, useRef, useState, type ReactNode } from "react";

export interface DrawerProps {
  open: boolean;
  title?: ReactNode;
  /** Action controls shown on the right of the header, before Close. */
  headerActions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  defaultWidth?: number;
}

/**
 * Docked right-side detail panel. Sits inline beside the list (a flex sibling),
 * so the content area shrinks rather than being covered. Drag its left edge to
 * resize. Renders nothing when closed; width persists across open/close.
 *
 * Every behaviour here is carried over from the classic component unchanged —
 * the drag, the focus handling and the Escape exclusions each exist for a
 * reason recorded below, and none of them is re-derivable from the mock's
 * Inspector, which has the drag and nothing else. Only the appearance moved.
 * (#318)
 */
export function Drawer({
  open,
  title,
  headerActions,
  onClose,
  children,
  defaultWidth = 480,
}: DrawerProps) {
  const [width, setWidth] = useState(defaultWidth);
  const handleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => setWidth(defaultWidth), [defaultWidth]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    function move(e: MouseEvent) {
      // Dragging the left edge: the panel grows as the pointer moves left.
      const next = startW.current - (e.clientX - startX.current);
      setWidth(Math.max(320, Math.min(960, next)));
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
    }
    function down(e: MouseEvent) {
      e.preventDefault();
      startX.current = e.clientX;
      startW.current = widthRef.current;
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    }
    handle.addEventListener("mousedown", down);
    return () => {
      handle.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
    };
  }, [open]);

  // Move focus into the panel when it opens, and hand it back to whatever
  // opened it when it closes (#160). The drawer is deliberately NOT modal — it
  // sits beside the list rather than over it, so focus is placed, never
  // trapped: a keyboard user can tab straight back out to the rows behind.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    returnFocusTo.current = opener instanceof HTMLElement ? opener : null;
    panelRef.current?.focus();
    return () => {
      // Only if focus is still inside the closing panel: the user may have
      // clicked elsewhere, and yanking focus back would be the panel arguing
      // with them on the way out.
      const active = document.activeElement;
      const inside = panelRef.current?.contains(active as Node) || active === document.body;
      if (inside && returnFocusTo.current?.isConnected) returnFocusTo.current.focus();
    };
  }, [open]);

  // Close on Escape while open. Bail when a modal dialog is layered on top — it
  // owns Esc, so the first Esc closes the dialog and a second closes the drawer —
  // and when focus is in an editable field / the manifest editor, where Esc has
  // its own meaning.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <aside
      ref={panelRef}
      aria-label="Details"
      // -1: focusable so opening can land here, but never a Tab stop of its
      // own — tabbing from the list should reach the panel's controls, not the
      // panel itself.
      tabIndex={-1}
      style={{ width, borderLeft: "1px solid var(--rule)", background: "var(--surface)" }}
      // Deliberately not the design's `.pane`, which sets `flex: 1`: this panel
      // is sized by the drag, and a growing flex child ignores its own width.
      // (#323 review)
      className="relative flex shrink-0 flex-col outline-none"
    >
      <div
        ref={handleRef}
        aria-hidden="true"
        // The design's handle sits on a pane's right edge; this one is on the
        // left, since the drawer is what gets resized.
        className="resize-handle"
        style={{ left: -2, right: "auto" }}
      />
      <header className="pane-head">
        <div className="min-w-0 flex-1 truncate">{title}</div>
        <div className="flex items-center gap-1">{headerActions}</div>
        <button type="button" aria-label="Close" onClick={onClose} className="icon-btn">
          {/* Inline rather than an icon-set import: the kit takes no dependency
              on lucide, and this is the only glyph it needs. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="pane-body p-3">{children}</div>
    </aside>
  );
}
