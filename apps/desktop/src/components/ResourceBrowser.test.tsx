import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const {
  listNamespacesMock,
  podLogsMock,
  watchResourceMock,
  listNodesMock,
  getManifestMock,
  getObjectMock,
  listResourceMock,
} = vi.hoisted(() => ({
  listNamespacesMock: vi.fn(),
  podLogsMock: vi.fn(),
  watchResourceMock: vi.fn(),
  listNodesMock: vi.fn(),
  getManifestMock: vi.fn(),
  getObjectMock: vi.fn(),
  listResourceMock: vi.fn(),
}));
vi.mock("../lib/workloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/workloads")>();
  return {
    ...actual,
    listNamespaces: listNamespacesMock,
    podLogs: podLogsMock,
    podMetrics: async () => ({ metrics: [] }),
  };
});
vi.mock("../lib/manifest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/manifest")>();
  return {
    ...actual,
    listNodes: listNodesMock,
    getManifest: getManifestMock,
    getObject: getObjectMock,
    listResource: listResourceMock,
  };
});
vi.mock("../lib/watch", () => ({
  watchResource: watchResourceMock,
  WATCHABLE_KINDS: ["pods", "deployments", "services"],
}));
vi.mock("./PodTerminal", () => ({ PodTerminal: () => <div data-testid="pod-terminal" /> }));
// CodeMirror needs real layout (unavailable in jsdom); stand in a textarea.
vi.mock("../ui/CodeEditor", () => ({
  CodeEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange?: (v: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

import { ResourceBrowser } from "./ResourceBrowser";

const pod = {
  name: "web-1",
  namespace: "default",
  phase: "Running",
  ready: "1/1",
  restarts: 0,
  node: "node-a",
};

// watchResource(ctx, ns, kind, onRows) — push one snapshot, return a handle.
function watchWith(rows: Array<{ name: string }>) {
  return (_ctx: string, _ns: string, _kind: string, onRows: (r: unknown) => void) => {
    onRows(rows);
    return Promise.resolve({ stop: vi.fn() });
  };
}

beforeEach(() => {
  listNamespacesMock.mockReset();
  podLogsMock.mockReset();
  watchResourceMock.mockReset();
  listNodesMock.mockReset();
  getManifestMock.mockReset();
  getObjectMock.mockReset();
  getObjectMock.mockResolvedValue({ object: { metadata: { name: "web" } } });
  listResourceMock.mockReset();
});

describe("ResourceBrowser", () => {
  it("streams pods live", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(watchWith([pod]));

    render(<ResourceBrowser context="kind-dev" kind="pods" />);

    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "pods", expect.any(Function), expect.any(Function));
    expect(screen.getByText("live")).toBeDefined();
  });

  it("streams deployments live", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "web", namespace: "default", ready: "1/1", upToDate: 1, available: 1 }]),
    );

    render(<ResourceBrowser context="kind-dev" kind="deployments" />);

    await waitFor(() => expect(screen.getByText("web")).toBeDefined());
    expect(watchResourceMock).toHaveBeenCalledWith("kind-dev", "", "deployments", expect.any(Function), expect.any(Function));
  });

  it("starts on the provided namespace and reports filter changes", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default", "kube-system"] });
    watchResourceMock.mockImplementation(watchWith([pod]));
    const onNamespaceChange = vi.fn();
    render(
      <ResourceBrowser
        context="kind-dev"
        kind="pods"
        initialNamespace="kube-system"
        onNamespaceChange={onNamespaceChange}
      />,
    );
    // Watches the initial (preserved) namespace, not "all".
    await waitFor(() =>
      expect(watchResourceMock).toHaveBeenCalledWith(
        "kind-dev",
        "kube-system",
        "pods",
        expect.any(Function),
        expect.any(Function),
      ),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Namespace" }));
    await userEvent.click(await screen.findByRole("option", { name: "default" }));
    expect(onNamespaceChange).toHaveBeenCalledWith("default");
    await waitFor(() =>
      expect(watchResourceMock).toHaveBeenCalledWith(
        "kind-dev",
        "default",
        "pods",
        expect.any(Function),
        expect.any(Function),
      ),
    );
  });

  it("opens the pod detail drawer when a pod row is clicked", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(watchWith([pod]));
    render(<ResourceBrowser context="kind-dev" kind="pods" />);
    await waitFor(() => screen.getByText("web-1"));
    fireEvent.click(screen.getByText("web-1"));

    // The detail side-panel opens with the pod action icons in its header.
    await waitFor(() => expect(screen.getByRole("button", { name: "Shell" })).toBeDefined());
    expect(screen.getByRole("button", { name: "Logs" })).toBeDefined();
    expect(screen.getByRole("complementary", { name: "Details" })).toBeDefined();
  });

  it("deep-links to a resource's detail via the focus prop (global search)", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(watchWith([pod]));
    render(
      <ResourceBrowser
        context="kind-dev"
        kind="pods"
        focus={{ name: "web-1", namespace: "default", nonce: 1 }}
      />,
    );
    // Detail opens automatically once the matching row loads — no click needed.
    await waitFor(() => expect(screen.getByRole("button", { name: "Shell" })).toBeDefined());
    expect(screen.getByRole("complementary", { name: "Details" })).toBeDefined();
  });

  it("opens a tabbed detail with a YAML tab when a deployment row is clicked", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    watchResourceMock.mockImplementation(
      watchWith([{ name: "web", namespace: "default", ready: "1/1", upToDate: 1, available: 1 }]),
    );
    getManifestMock.mockResolvedValue({ yaml: "kind: Deployment\nmetadata:\n  name: web\n" });
    render(<ResourceBrowser context="kind-dev" kind="deployments" />);
    await waitFor(() => screen.getByText("web"));

    fireEvent.click(screen.getByText("web"));

    // Drawer opens on the Overview tab; switch to YAML to see the manifest.
    await waitFor(() => screen.getByRole("tab", { name: "YAML" }));
    await userEvent.click(screen.getByRole("tab", { name: "YAML" }));

    await waitFor(() =>
      expect((screen.getByLabelText("Manifest YAML") as HTMLTextAreaElement).value).toContain(
        "kind: Deployment",
      ),
    );
    expect(getManifestMock).toHaveBeenCalledWith(
      "kind-dev",
      "Deployment",
      "default",
      "web",
      undefined,
      undefined,
    );
  });

  it("lists a generic kind (configmaps) via listResource", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listResourceMock.mockResolvedValue({ items: [{ name: "cm-1", namespace: "default" }] });
    render(<ResourceBrowser context="kind-dev" kind="configmaps" />);

    await waitFor(() => expect(screen.getByText("cm-1")).toBeDefined());
    expect(listResourceMock).toHaveBeenCalledWith("kind-dev", "ConfigMap", "");
    expect(watchResourceMock).not.toHaveBeenCalled();
  });

  it("lists cluster-scoped nodes without a namespace selector", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listNodesMock.mockResolvedValue({
      nodes: [{ name: "cp-1", status: "Ready", version: "v1.35.0", roles: "control-plane" }],
    });
    render(<ResourceBrowser context="kind-dev" kind="nodes" />);

    await waitFor(() => expect(screen.getByText("cp-1")).toBeDefined());
    expect(listNodesMock).toHaveBeenCalledWith("kind-dev");
    expect(screen.queryByLabelText("Namespace")).toBeNull();
  });

  it("shows a namespace load error and does not watch", async () => {
    listNamespacesMock.mockResolvedValue({ error: "forbidden: namespaces" });
    render(<ResourceBrowser context="kind-dev" kind="pods" />);
    await waitFor(() => expect(screen.getByText(/forbidden: namespaces/)).toBeDefined());
    expect(watchResourceMock).not.toHaveBeenCalled();
  });

  it("shows a resource load error for nodes", async () => {
    listNamespacesMock.mockResolvedValue({ namespaces: ["default"] });
    listNodesMock.mockResolvedValue({ error: "list nodes timed out" });
    render(<ResourceBrowser context="kind-dev" kind="nodes" />);
    await waitFor(() => expect(screen.getByText(/list nodes timed out/)).toBeDefined());
  });
});
