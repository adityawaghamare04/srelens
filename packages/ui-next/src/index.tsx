import { useState, useSyncExternalStore } from "react";
import { Gallery } from "@srelens/ui-kit/gallery";
import { Window } from "./shell/Window";

export { ConsoleProvider, useConsole, type ConsoleValue } from "./console";

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * The current location hash, as state rather than as a render-time read.
 *
 * Reading `window.location.hash` while rendering subscribes to nothing, so the
 * browser fires `hashchange` and React never hears about it: navigating to
 * #gallery left the placeholder up, and navigating away left the gallery up,
 * until a reload. (#317 review)
 */
function useHash(): string {
  return useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    // No hash on a server render; the client picks it up on hydration.
    () => "",
  );
}

/**
 * The new design's root: the window, and nothing else.
 *
 * The screens arrive one at a time; until a route has one, its tab renders the
 * Placeholder — so the design is navigable from the first PR rather than being
 * a single "nothing here yet" page. This package having its own tree and its
 * own stylesheet is what proves the two designs never share a document.
 *
 * The component gallery lives here too, at #gallery: a developer surface rather
 * than a screen, so it is a hash and not a route. The way *in* is on the
 * Placeholder, because that is the screen every un-ported route renders.
 *
 * `onExit` is the way back to the classic design. Settings does not exist in
 * this tree yet, so without it someone who opts in would have no route out of
 * the app except editing localStorage — which is why the Placeholder's "Open in
 * classic" is wired to it rather than to a per-route handoff, which is PR 3.
 */
export function NextApp({
  onExit,
  ported = [],
}: {
  onExit: () => Promise<string | null> | string | null;
  /** Display names of the screens that exist in the new design. */
  ported?: string[];
}) {
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    // Rendered here rather than raised as a toast: the toast host lives in the
    // classic tree, so a failure on the way out would have been invisible and
    // this button would have looked inert. (#314 review)
    setError((await onExit()) ?? null);
  }

  // A hash rather than a route: this tree has no router yet, and the gallery is
  // a developer surface rather than a screen.
  if (useHash() === "#gallery") {
    return <Gallery />;
  }

  return (
    // A flex column rather than the Window and the alert as siblings: `body` is
    // `overflow: hidden` and `#root` is `height: 100%`, so an alert next to an
    // `h-full` Window starts at the bottom edge and is clipped — in the DOM and
    // the a11y tree, and off screen. That is the silent failure #314 closed, so
    // the Window gets the room that is left and the alert keeps its own.
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <Window
          ported={ported}
          onOpenInClassic={() => void leave()}
          onOpenGallery={() => {
            window.location.hash = "#gallery";
          }}
        />
      </div>
      {error && (
        <p role="alert" className="shrink-0 px-3 py-2 text-[0.75rem] text-[var(--sev)]">
          Could not switch design. {error}
        </p>
      )}
    </div>
  );
}
