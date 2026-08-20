import { isTauri, notify } from "@srelens/core";

/**
 * Which design the app renders.
 *
 * Read synchronously before React mounts, so it lives in localStorage rather
 * than the settings store, which is async. It describes the person using the
 * app, not the cluster they are looking at, so it is not scoped to a context
 * or a workspace.
 *
 * This module deliberately sits outside `main.tsx`: importing the entry module
 * from a component or a test would run its side effects — installing the
 * notifier and starting the app.
 */
export const DESIGN_KEY = "srelens.design";

export type Design = "classic" | "next";

export function loadDesign(): Design {
  try {
    // Anything unrecognised means classic. A preference written by a future
    // version must never leave someone on a design that does not exist, since
    // a blank window has no way back to Settings.
    return localStorage.getItem(DESIGN_KEY) === "next" ? "next" : "classic";
  } catch {
    // Storage throws in some privacy modes; a preference is not worth failing
    // to boot over.
    return "classic";
  }
}

/** Persist the choice. Returns false if storage refused it. */
export function saveDesign(design: Design): boolean {
  try {
    localStorage.setItem(DESIGN_KEY, design);
    return true;
  } catch {
    // Restricted or private storage. The caller must not reload on this: the
    // next boot would read no preference and come back on the old design.
    return false;
  }
}

/**
 * Apply a design choice.
 *
 * Reloads rather than swapping trees in place: the two designs' stylesheets
 * cannot share a document — both import Tailwind, use different dark-mode
 * conventions and write global rules — and unloading one at runtime is not
 * something the platform offers. A reload on a deliberate, rare action is a
 * fair price for removing a whole class of style-bleed bug.
 */
/**
 * Whether the new design draws its own titlebar yet.
 *
 * It does not: `NextApp` is a heading, a paragraph and a button. Dropping the
 * system decorations now would leave a frameless window with no drag region and
 * no window controls — unmovable, unminimisable, and closable only by quitting
 * the app. The design's own titlebar lands with its shell; this flips then, and
 * needs an answer for Windows and Linux at the same time, since the mock's
 * traffic lights are macOS-shaped.
 */
const NEXT_DESIGN_DRAWS_ITS_OWN_CHROME = false;

export async function switchDesign(design: Design): Promise<void> {
  if (!saveDesign(design)) {
    // The choice could not be persisted, so a reload would come back on the
    // old design — and on desktop it could do so with the chrome already
    // changed. Better to leave everything alone and say nothing changed than
    // to reload into a window that contradicts the setting.
    notify.error(
      "Could not switch design",
      "This device would not let srelens save the preference.",
    );
    return;
  }
  if (isTauri() && NEXT_DESIGN_DRAWS_ITS_OWN_CHROME) {
    try {
      // Cosmetic, and explicitly not allowed to block the switch:
      // `core:window:allow-set-decorations` has to be granted in the app's
      // capabilities, and on a build where it is not, this throws. Letting
      // that reject left the preference written and the window unchanged, so
      // the design only appeared after a manual restart.
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setDecorations(design === "classic");
    } catch {
      // Wrong chrome is a blemish; not switching at all is a broken setting.
    }
  }
  window.location.reload();
}
