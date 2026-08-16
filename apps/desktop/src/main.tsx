import "./styles/globals.css"; // Tailwind + shadcn tokens — must load first.
import React from "react";
import { createRoot } from "react-dom/client";
import AppGate from "./AppGate";
import { applyPersistedTimeout } from "./lib/requestTimeout";
import { isTauri } from "./transport/platform";
import { initializeSettingsStorage } from "./lib/settingsStorage";

// Re-apply the persisted request timeout to the backend, which resets to its
// default each launch. Fire-and-forget: it resolves well before the user picks
// a context and triggers the first capability call. Tauri-only: on web this
// would race an unauthenticated 401 before the login gate resolves.
const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");

async function bootstrap(): Promise<void> {
  await initializeSettingsStorage();
  if (isTauri()) void applyPersistedTimeout();
  createRoot(container).render(<AppGate />);
}

void bootstrap();
