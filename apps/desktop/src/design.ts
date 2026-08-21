import { isApplePlatform, isTauri } from "@srelens/core";
// theme.ts imports only settingsStorage, so this does not drag the classic
// stylesheet into the new design's chunk.
import { applyTheme, getInitialTheme, resolvedThemeMode } from "./ui/theme";

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
/** Whether a design switch went through, and why not when it did not. */
export type SwitchResult = { ok: true } | { ok: false; reason: string };

/**
 * Whether the new design draws its own titlebar here.
 *
 * The mock's traffic lights are macOS-shaped, so only Apple gets the overlay
 * for now; Windows and Linux keep the system decorations until the design has
 * an answer for their controls. Optional argument for the callers that already
 * hold a platform string; the runtime answers for itself when they do not.
 */
export function drawsOwnChrome(platform?: string): boolean {
  return isApplePlatform(platform);
}

/**
 * Dress the window for the new design, once per boot of it.
 *
 * The titlebar goes overlay so the design's own Titlebar sits flush under the
 * traffic lights without doubling the chrome. Cosmetic, and explicitly not
 * allowed to block boot: on a build where
 * `core:window:allow-set-title-bar-style` is not granted this throws, and a
 * rejecting promise escaping would have left bootstrap awaiting forever — a
 * blank window instead of an undressed one.
 */
export async function applyNextDesignChrome(): Promise<void> {
  if (!isTauri() || !drawsOwnChrome()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitleBarStyle("overlay");
  } catch {
    // Wrong chrome is a blemish; a failed boot is a broken app.
  }
}

export async function switchDesign(design: Design): Promise<SwitchResult> {
  if (!saveDesign(design)) {
    // The choice could not be persisted, so a reload would come back on the
    // old design — and on desktop it could do so with the chrome already
    // changed. Leave everything alone and report it.
    //
    // Reported to the caller rather than raised as a toast: the toast host
    // lives in the classic tree, so a failure while leaving the new design
    // would have been invisible, and the button would have looked inert.
    return { ok: false, reason: "This device would not let srelens save the preference." };
  }
  if (design === "classic" && isTauri() && drawsOwnChrome()) {
    try {
      // Leaving the new design means handing the system titlebar back: classic
      // renders under the real decorations, and an overlay left behind would
      // double the chrome. Going the other way dresses nothing here — the next
      // boot's applyNextDesignChrome owns that direction.
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setTitleBarStyle("visible");
    } catch {
      // Wrong chrome is a blemish; not switching at all is a broken setting.
    }
  }
  window.location.reload();
  return { ok: true };
}

/**
 * Carry the user's light/dark choice into the new design.
 *
 * The two designs disagree about what `data-theme` means: the classic one puts
 * the palette name there (`slate`) and the mode in `data-theme-mode`, while
 * ui-next's stylesheet reads `data-theme="dark"` as the mode itself. Nothing
 * translates between them, and a reload starts from a bare document — so
 * without this the new design always rendered light, including for the many
 * users on the classic default, which is dark. (#314 review)
 *
 * Light is the absence of the attribute, matching ui-next's `:root` tokens.
 */
/**
 * The new design's reading of the stored preference, as an attribute on the
 * root. Shared by boot, the system-appearance listener and the toggle — three
 * writers of one convention is two too many.
 *
 * Light is the absence of the attribute, matching ui-next's `:root` tokens.
 */
function applyNextThemeAttribute(): void {
  const root = document.documentElement;
  if (resolvedThemeMode(getInitialTheme().mode) === "dark") {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }
}

export function applyNextDesignTheme(): () => void {
  applyNextThemeAttribute();

  // Someone on "system" changes appearance while the app is open, and the new
  // tree has no equivalent of the classic App's matchMedia effect, so it would
  // sit on a stale palette until the next reload. (#314 review)
  if (getInitialTheme().mode !== "system") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => applyNextThemeAttribute();
  query.addEventListener("change", apply);
  return () => query.removeEventListener("change", apply);
}

/**
 * Flip light/dark for both designs at once.
 *
 * The write goes through classic's `applyTheme`, so one stored preference
 * drives both designs; but that write leaves classic's conventions on the root
 * (`data-theme` = palette name), which ui-next reads as a mode. Re-asserting
 * our own attribute afterwards keeps the two designs' readings from fighting
 * over the same element.
 */
export function toggleNextDesignTheme(): void {
  const current = getInitialTheme();
  const mode = resolvedThemeMode(current.mode);
  applyTheme({ ...current, mode: mode === "dark" ? "light" : "dark" });
  applyNextThemeAttribute();
}

/**
 * Which screens exist in the new design. Classic's Settings shows this beside
 * the toggle so the choice is informed before it is made, and the new design's
 * Placeholder shows it so the user knows what is there. One list, read by both,
 * so they cannot drift. A screen is added here in the PR that ports it.
 */
export const PORTED_SCREENS: ReadonlyArray<{ route: string; name: string }> = [
  { route: "/applog", name: "Application log" },
  { route: "/notes", name: "Release notes" },
];
