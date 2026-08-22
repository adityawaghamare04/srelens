import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { K8sObject, PodMetric, PodSummary } from "@srelens/core";

// A ConfigMap has no `relatedPodSelector` match, so `GenericBody`'s Pods
// section never fires for it — `podsForSelector`/`podMetrics` are mocked
// anyway, purely so the composition test below can render `GenericBody`
// without a live cluster call escaping the mock boundary.
const { podsForSelector, podMetrics } = vi.hoisted(() => ({
  podsForSelector: vi.fn(async (): Promise<{ pods?: PodSummary[]; error?: string }> => ({ pods: [] })),
  podMetrics: vi.fn(async (): Promise<{ metrics?: PodMetric[]; error?: string }> => ({ metrics: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  podsForSelector,
  podMetrics,
}));

import { ConfigDetailsBody } from "./ConfigBody";
import { GenericBody } from "./GenericBody";

function configMap(data: Record<string, string> = {}): K8sObject {
  return {
    kind: "ConfigMap",
    apiVersion: "v1",
    metadata: { name: "app-config", namespace: "default" },
    data,
  } as K8sObject;
}

describe("ConfigDetailsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    podsForSelector.mockResolvedValue({ pods: [] });
    podMetrics.mockResolvedValue({ metrics: [] });
  });

  it("shows each key and its value, unmasked", () => {
    render(<ConfigDetailsBody object={configMap({ "app.conf": "level=info", "feature.flag": "on" })} />);
    expect(screen.getByText("Data (2 keys)")).toBeDefined();
    expect(screen.getByText("app.conf")).toBeDefined();
    expect(screen.getByText("level=info")).toBeDefined();
    expect(screen.getByText("feature.flag")).toBeDefined();
    expect(screen.getByText("on")).toBeDefined();
  });

  it("preserves a multi-line value's line breaks", () => {
    render(<ConfigDetailsBody object={configMap({ "nginx.conf": "server {\n  listen 80;\n}" })} />);
    const value = screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === "server {\n  listen 80;\n}");
    expect(value).toBeDefined();
  });

  it("shows an empty state for a ConfigMap with no data", () => {
    render(<ConfigDetailsBody object={configMap()} />);
    expect(screen.getByText("Data (0 keys)")).toBeDefined();
    expect(screen.getByText("No data")).toBeDefined();
  });

  describe("composition with GenericBody", () => {
    it("renders exactly one Metadata heading and no Pods section", async () => {
      const cm = configMap({ "app.conf": "level=info" });
      render(
        <GenericBody kind="ConfigMap" object={cm} context="ctx">
          <ConfigDetailsBody object={cm} />
        </GenericBody>,
      );
      expect(screen.getAllByRole("heading", { name: "Metadata" })).toHaveLength(1);
      expect(screen.queryAllByRole("heading", { name: "Pods" })).toHaveLength(0);
      expect(podsForSelector).not.toHaveBeenCalled();
    });
  });
});
