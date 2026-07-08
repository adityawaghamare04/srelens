import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

// Capture the Tauri event handler App registers for the macOS Cmd+W menu item,
// and a stub window so we can assert tab-close vs. window-close behavior.
const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (e: { payload: unknown }) => void>();
  const windowClose = vi.fn();
  return {
    handlers,
    windowClose,
    listen: vi.fn((name: string, cb: (e: { payload: unknown }) => void) => {
      handlers.set(name, cb);
      return Promise.resolve(() => handlers.delete(name));
    }),
  };
});
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: tauri.windowClose }),
}));

vi.mock("./components/ClusterHotbar", () => ({
  ClusterHotbar: ({
    onOpenContext,
    onOpenSettings,
  }: {
    onOpenContext: (c: string) => void;
    onOpenSettings: () => void;
  }) => (
    <div>
      <button onClick={() => onOpenContext("kind-dev")}>open-kind-dev</button>
      <button onClick={() => onOpenContext("prod")}>open-prod</button>
      <button onClick={onOpenSettings}>open-settings</button>
    </div>
  ),
}));
vi.mock("./components/Sidebar", () => ({
  Sidebar: ({
    onSelect,
    activeCluster,
  }: {
    onSelect: (c: string, k: string) => void;
    activeCluster: string;
  }) => <button onClick={() => onSelect(activeCluster, "services")}>nav-services</button>,
}));
vi.mock("./components/ClusterOverview", () => ({
  ClusterOverview: ({ context }: { context: string }) => (
    <div data-testid="overview">{context}</div>
  ),
}));
vi.mock("./components/ResourceBrowser", () => ({
  RESOURCE_LABELS: { overview: "Overview", pods: "Pods", services: "Services", settings: "Settings" },
  K8S_KIND: { overview: "", pods: "Pod", services: "Service", settings: "" },
  ResourceBrowser: ({
    context,
    kind,
    onOpenResource,
  }: {
    context: string;
    kind: string;
    onOpenResource?: (target: { kind: string; namespace: string | null; name: string }) => void;
  }) => (
    <div data-testid="browser">
      {context}:{kind}
      <button
        onClick={() => onOpenResource?.({ kind: "Pod", namespace: "default", name: "web-1" })}
      >
        linked-pod
      </button>
    </div>
  ),
}));
vi.mock("./components/SettingsView", () => ({
  SettingsView: () => <div data-testid="settings">workspace settings</div>,
}));

import { App } from "./App";

describe("App", () => {
  it("shows the welcome state until a cluster is opened", () => {
    render(<App />);
    expect(screen.getByText(/pure-Rust Kubernetes UI/)).toBeDefined();
    expect(screen.queryByTestId("overview")).toBeNull();
  });

  it("opening a cluster lands on its Overview tab", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
    expect(screen.getByRole("tab", { name: /Overview · kind-dev/ })).toBeDefined();
  });

  it("selecting a resource opens a separate (cluster, kind) tab", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("nav-services")); // sidebar → Services

    expect(screen.getByTestId("browser").textContent).toContain("kind-dev:services");
    expect(screen.getByRole("tab", { name: /Overview · kind-dev/ })).toBeDefined();
    expect(screen.getByRole("tab", { name: /Services · kind-dev/ })).toBeDefined();

    fireEvent.click(screen.getByRole("tab", { name: /Overview · kind-dev/ }));
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
  });

  it("opens linked Kubernetes resources in their product view", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("nav-services"));
    fireEvent.click(screen.getByText("linked-pod"));
    expect(screen.getByTestId("browser").textContent).toContain("kind-dev:pods");
  });

  it("opens views across multiple clusters and closes tabs", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("open-prod"));

    expect(screen.getByTestId("overview").textContent).toBe("prod");
    expect(screen.getByRole("tab", { name: /Overview · prod/ })).toBeDefined();

    fireEvent.click(screen.getByLabelText("Close Overview · prod"));
    expect(screen.queryByRole("tab", { name: /Overview · prod/ })).toBeNull();
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
  });

  it("focuses an existing tab instead of duplicating it", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("nav-services"));
    fireEvent.click(screen.getByText("nav-services")); // again → no duplicate

    expect(screen.getAllByRole("tab", { name: /Services · kind-dev/ })).toHaveLength(1);
  });

  it("opens settings as a global workspace tab", () => {
    render(<App />);
    fireEvent.click(screen.getByText("open-settings"));

    expect(screen.getByTestId("settings").textContent).toBe("workspace settings");
    expect(screen.getByRole("tab", { name: /^Settings$/ })).toBeDefined();
    expect(screen.queryByText("nav-services")).toBeNull();
  });

  it("close-active-tab (Cmd+W) closes the active tab, not the window", () => {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    tauri.windowClose.mockClear();
    render(<App />);
    fireEvent.click(screen.getByText("open-kind-dev"));
    fireEvent.click(screen.getByText("open-prod"));
    expect(screen.getByTestId("overview").textContent).toBe("prod");

    const handler = tauri.handlers.get("close-active-tab");
    expect(handler).toBeDefined();
    act(() => handler!({ payload: undefined }));

    expect(screen.queryByRole("tab", { name: /Overview · prod/ })).toBeNull();
    expect(screen.getByTestId("overview").textContent).toBe("kind-dev");
    expect(tauri.windowClose).not.toHaveBeenCalled();
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });

  it("close-active-tab (Cmd+W) closes the window when no tabs remain", () => {
    (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    tauri.windowClose.mockClear();
    render(<App />);

    const handler = tauri.handlers.get("close-active-tab");
    expect(handler).toBeDefined();
    act(() => handler!({ payload: undefined }));

    expect(tauri.windowClose).toHaveBeenCalledTimes(1);
    delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });
});
