import { isTauri } from "@srelens/core/platform";

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

export function saveDesign(design: Design): void {
  try {
    localStorage.setItem(DESIGN_KEY, design);
  } catch {
    // Nothing useful to do. The switch below still applies for this session.
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
export async function switchDesign(design: Design): Promise<void> {
  saveDesign(design);
  if (isTauri()) {
    // The new design draws its own titlebar; the classic one uses the system's.
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setDecorations(design === "classic");
  }
  window.location.reload();
}
