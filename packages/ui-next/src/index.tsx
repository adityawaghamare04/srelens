import { useState } from "react";

/**
 * The new design's root.
 *
 * A placeholder for now. This package exists so the design switch has a real
 * second tree to load, with its own stylesheet — which is what proves the two
 * designs never share a document. The shell and screens arrive in later steps.
 *
 * It carries its own way back to the classic design on purpose: Settings does
 * not exist here yet, so without this button someone who opts in would have no
 * route out of the app except editing localStorage.
 */
export function NextApp({ onExit }: { onExit: () => Promise<string | null> | string | null }) {
  const [error, setError] = useState<string | null>(null);

  async function leave() {
    // Rendered here rather than raised as a toast: the toast host lives in the
    // classic tree, so a failure on the way out would have been invisible and
    // this button would have looked inert. (#314 review)
    setError((await onExit()) ?? null);
  }

  return (
    <main className="next-placeholder">
      <h1>The new design</h1>
      <p>
        Nothing is built here yet. You are seeing this because the new design is
        switched on in Settings — the screens are still being written.
      </p>
      <button type="button" onClick={() => void leave()}>
        Back to the classic design
      </button>
      {error && <p role="alert">Could not switch design. {error}</p>}
    </main>
  );
}
