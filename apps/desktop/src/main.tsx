import React from "react";
import { createRoot } from "react-dom/client";
import { applyPersistedTimeout } from "@srelens/core";
import { isTauri } from "@srelens/core/platform";
import { initializeSettingsStorage } from "@srelens/core";
// The service layer says what to notify; this decides how. Installed before
// render so a toast raised during startup is not dropped on the floor.
import { installToastNotifier } from "./ui/notifier";
import {
  PORTED_SCREENS,
  applyNextDesignChrome,
  applyNextDesignTheme,
  drawsOwnChrome,
  loadDesign,
  switchDesign,
  toggleNextDesignTheme,
} from "./design";

installToastNotifier();

// Re-apply the persisted request timeout to the backend, which resets to its
// default each launch. Fire-and-forget: it resolves well before the user picks
// a context and triggers the first capability call. Tauri-only: on web this
// would race an unauthenticated 401 before the login gate resolves.
const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

// The container is passed in rather than captured: `bootstrap` is a hoisted
// function declaration, so TypeScript cannot rely on the null check above
// having run before a call and keeps the type as HTMLElement | null inside.
async function bootstrap(root: HTMLElement): Promise<void> {
  await initializeSettingsStorage();
  if (isTauri()) void applyPersistedTimeout();
  // Both the stylesheet AND the tree are imported dynamically. Only the
  // stylesheet is not enough: ui/index.ts imports ui/styles.css, so a
  // statically imported AppGate drags that into the entry chunk, which
  // index.html then links unconditionally — and the classic design's CSS would
  // load underneath the new one. Verified against a real build.
  if (loadDesign() === "next") {
    // Before the stylesheet, so the first paint is already the right mode.
    applyNextDesignTheme();
    // The overlay titlebar goes on before anything renders, so the window is
    // never seen with doubled chrome. A rejection inside is swallowed there:
    // an undressed window beats a blank one.
    await applyNextDesignChrome();
    // Started together, awaited together: the stylesheet and the tree are
    // independent downloads, and awaiting one before requesting the other
    // serialised them. index.html links no stylesheet, so the window stays
    // blank until both land — that wait is the whole startup screen.
    const [, { NextApp }] = await Promise.all([
      import("@srelens/ui-next/styles"),
      import("@srelens/ui-next"),
    ]);
    createRoot(root).render(
      <NextApp
        ported={PORTED_SCREENS.map((s) => s.name)}
        controls={drawsOwnChrome() ? "macos" : "none"}
        onToggleTheme={toggleNextDesignTheme}
        onExit={async () => {
          const result = await switchDesign("classic");
          return result.ok ? null : result.reason;
        }}
      />,
    );
    return;
  }
  const [, { default: AppGate }] = await Promise.all([
    import("./styles/globals.css"),
    import("./AppGate"),
  ]);
  createRoot(root).render(<AppGate />);
}

void bootstrap(container);
