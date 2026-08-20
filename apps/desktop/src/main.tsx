import "./styles/globals.css"; // Tailwind + shadcn tokens — must load first.
import React from "react";
import { createRoot } from "react-dom/client";
import AppGate from "./AppGate";
import { applyPersistedTimeout } from "@srelens/core";
import { isTauri } from "@srelens/core/platform";
import { initializeSettingsStorage } from "@srelens/core";
// The service layer says what to notify; this decides how. Installed before
// render so a toast raised during startup is not dropped on the floor.
import { installToastNotifier } from "./ui/notifier";

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
  createRoot(root).render(<AppGate />);
}

void bootstrap(container);
