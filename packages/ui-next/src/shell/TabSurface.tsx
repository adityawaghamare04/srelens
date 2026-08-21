import type { ReactNode } from "react";

/**
 * One tab's view, kept mounted whether or not it is the one on screen.
 *
 * Switching tabs hides and shows rather than unmounting and remounting, the
 * way a desktop app behaves: coming back is instant, scroll position is where
 * it was, and a load that was in flight finishes instead of starting over. The
 * parent spec calls this out for Logs, where a stream that restarted on every
 * switch would be unusable; it is cheaper to have from the first tab than to
 * retrofit.
 *
 * `hidden` rather than a class: it removes the subtree from the accessibility
 * tree and the tab order as well as from view, which `display: none` also
 * does, but the attribute says what is meant. Every surface is absolutely
 * positioned over the same box, so the visible one is the only one laid out.
 */
export function TabSurface({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div hidden={!visible} className="absolute inset-0 flex min-h-0 flex-col">
      {children}
    </div>
  );
}
