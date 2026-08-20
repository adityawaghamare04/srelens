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
export function NextApp({ onExit }: { onExit: () => void }) {
  return (
    <main className="next-placeholder">
      <h1>The new design</h1>
      <p>
        Nothing is built here yet. You are seeing this because the new design is
        switched on in Settings — the screens are still being written.
      </p>
      <button type="button" onClick={onExit}>
        Back to the classic design
      </button>
    </main>
  );
}
