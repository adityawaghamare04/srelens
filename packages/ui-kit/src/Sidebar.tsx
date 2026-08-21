import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { EmptyState } from "./EmptyState";
import { filled } from "./slot";
import { TextInput } from "./TextInput";

export interface SidebarProps {
  /**
   * Names the landmark, and by extension the resize handle. Required: a page
   * with two unnamed `nav`s in it gives a screen reader two identical stops.
   */
  label: string;
  /** The way out of a drilled-in view, at the very top. */
  back?: { label: string; count?: ReactNode; onClick: () => void };
  /** The identity band under the back bar — whose cluster this is, how it connects. */
  header?: ReactNode;
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Names the filter box and fills its placeholder. */
  queryLabel?: string;
  /** The scrolling middle: a tree, a list, whatever the caller navigates by. */
  children?: ReactNode;
  emptyTitle?: ReactNode;
  emptyHint?: ReactNode;
  footer?: ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  /** Fired when a resize settles, so the app can persist it. */
  onWidthChange?: (width: number) => void;
  className?: string;
}

/** One arrow key's worth of width. Coarse enough to get somewhere, fine enough to aim. */
const STEP = 16;

/**
 * The app's left-hand navigation column: a way back, whose cluster you are
 * looking at, a filter, the tree itself, and whatever the app wants to keep in
 * view at the bottom — in a column the user can widen.
 *
 * Every one of those is a slot. The mock's sidebar reached into four modules to
 * fill them itself — the active tab's route, the workspace's clusters, the
 * hotbar's chips — and chose between two different trees on a flag it read from
 * a store. None of that is a design decision, and the kit cannot hold app state
 * anyway, so what is left is the frame: the bands, the rules between them, the
 * scrolling middle and the drag. What goes in them is the caller's, including
 * which tree; that is why this takes `children` rather than a `focused` flag.
 *
 * The resize is the part worth hardening. The mock's handle was a
 * `role="separator"` with a mousedown listener and no name, no value and no
 * keys — announced to assistive technology as a control, workable only by
 * pointer. Here it is named after the sidebar, carries its width as
 * `aria-valuenow` between its two bounds, and takes the arrow keys and
 * Home/End. The drag itself now measures from where the pointer went down
 * rather than from `clientX - 46`, which was the width of the rail the mock
 * happened to sit beside — an assumption about the shell that the kit is in no
 * position to make. Width is reported when it settles rather than persisted
 * here: `localStorage` is the app's, not the design system's. (#320)
 */
export function Sidebar({
  label,
  back,
  header,
  query,
  onQueryChange,
  queryLabel = "Filter resources",
  children,
  emptyTitle = "Nothing here",
  emptyHint,
  footer,
  defaultWidth = 238,
  minWidth = 180,
  maxWidth = 420,
  onWidthChange,
  className,
}: SidebarProps) {
  const [width, setWidth] = useState(defaultWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  // Whatever a drag in flight needs undone, so unmounting mid-drag does not
  // leave listeners on the window and the page unselectable.
  const release = useRef<() => void>(() => {});
  useEffect(() => () => release.current(), []);

  const clamp = (next: number) => Math.max(minWidth, Math.min(maxWidth, Math.round(next)));

  function commit(next: number) {
    const settled = clamp(next);
    setWidth(settled);
    onWidthChange?.(settled);
  }

  function onMouseDown(event: MouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const move = (e: globalThis.MouseEvent) => setWidth(clamp(startWidth + (e.clientX - startX)));
    const detach = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      release.current = () => {};
    };
    function up() {
      detach();
      // Once, on release. A caller persisting this should not be written to on
      // every pixel of the drag.
      onWidthChange?.(widthRef.current);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.userSelect = "none";
    release.current = detach;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = width + STEP;
    else if (event.key === "ArrowLeft") next = width - STEP;
    else if (event.key === "Home") next = minWidth;
    else if (event.key === "End") next = maxWidth;
    if (next === null) return;
    // Otherwise Home/End also jump the page and the arrows scroll the tree.
    event.preventDefault();
    commit(next);
  }

  return (
    <nav
      aria-label={label}
      className={cx("relative flex shrink-0 flex-col", className)}
      style={{ width, background: "var(--surface-sunk)" }}
    >
      {back && (
        <button type="button" className="focus-back rule-b" onClick={back.onClick}>
          {/* Inline rather than an icon-set import: the kit takes no dependency
              on lucide. */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
            <path
              d="m15 18-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="truncate">{back.label}</span>
          <span className="flex-1" />
          {filled(back.count) && <span className="tree-count">{back.count}</span>}
        </button>
      )}

      {filled(header) && (
        <div data-slot="header" className="rule-b px-2.5 py-2">
          {header}
        </div>
      )}

      {onQueryChange && (
        <div className="rule-b px-2 py-1.5">
          {/* The kit's input rather than the mock's bare one, which had a
              placeholder and no label — and a placeholder disappears the moment
              anything is typed into it. */}
          <TextInput
            type="search"
            value={query ?? ""}
            onValueChange={onQueryChange}
            placeholder={queryLabel}
            aria-label={queryLabel}
          />
        </div>
      )}

      <div className="scroll flex-1 py-1">
        {filled(children) ? children : <EmptyState title={emptyTitle} hint={emptyHint} />}
      </div>

      {filled(footer) && (
        <div data-slot="footer" className="rule-t p-2">
          {footer}
        </div>
      )}

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        // A resize a pointer can do and a keyboard cannot is not a resize.
        tabIndex={0}
        className="resize-handle"
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      />
    </nav>
  );
}
