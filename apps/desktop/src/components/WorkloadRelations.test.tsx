import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { DeployRevisions, ManagedPods } from "./WorkloadRelations";

describe("DeployRevisions", () => {
  it("renders the deployment's revisions newest-first", async () => {
    const onOpenResource = vi.fn();
    const listReplicaSetsFn = vi.fn().mockResolvedValue({
      replicasets: [
        { name: "web-5", revision: "5", desired: 1, ready: 1, current: 1, age: "56d" },
        { name: "web-4", revision: "4", desired: 0, ready: 0, current: 0, age: "66d" },
      ],
    });
    render(
      <DeployRevisions
        context="kind-dev"
        namespace="default"
        ownerName="web"
        onOpenResource={onOpenResource}
        listReplicaSetsFn={listReplicaSetsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("web-5")).toBeDefined());
    expect(screen.getByText("1/1")).toBeDefined();
    expect(screen.getByText("0/0")).toBeDefined();
    expect(listReplicaSetsFn).toHaveBeenCalledWith("kind-dev", "default", "web");
    fireEvent.click(screen.getByText("web-5"));
    expect(onOpenResource).toHaveBeenCalledWith({
      kind: "ReplicaSet",
      namespace: "default",
      name: "web-5",
    });
  });
});

describe("ManagedPods", () => {
  it("lists pods matched by the selector and merges metrics", async () => {
    const onOpenResource = vi.fn();
    const podsForSelectorFn = vi.fn().mockResolvedValue({
      pods: [
        { name: "web-1", namespace: "default", phase: "Running", ready: "1/1", restarts: 0, node: "node-a", age: "2d" },
      ],
    });
    const podMetricsFn = vi.fn().mockResolvedValue({
      metrics: [{ name: "web-1", namespace: "default", cpuMillicores: 12, memoryMiB: 28 }],
    });
    render(
      <ManagedPods
        context="kind-dev"
        namespace="default"
        selector={{ app: "web" }}
        onOpenResource={onOpenResource}
        podsForSelectorFn={podsForSelectorFn}
        podMetricsFn={podMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(screen.getByText("node-a")).toBeDefined();
    expect(screen.getByText("0.012")).toBeDefined(); // 12m → 0.012 cores
    expect(screen.getByText("28 Mi")).toBeDefined();
    expect(podsForSelectorFn).toHaveBeenCalledWith("kind-dev", "default", { app: "web" });
    fireEvent.click(screen.getByRole("button", { name: "Open Pod web-1" }));
    expect(onOpenResource).toHaveBeenCalledWith({
      kind: "Pod",
      namespace: "default",
      name: "web-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Node node-a" }));
    expect(onOpenResource).toHaveBeenLastCalledWith({
      kind: "Node",
      namespace: null,
      name: "node-a",
    });
  });

  it("still lists pods when metrics are unavailable", async () => {
    const podsForSelectorFn = vi.fn().mockResolvedValue({
      pods: [
        { name: "web-1", namespace: "default", phase: "Running", ready: "1/1", restarts: 0, node: "node-a", age: "2d" },
      ],
    });
    const podMetricsFn = vi.fn().mockResolvedValue({ error: "metrics-server not found" });
    render(
      <ManagedPods
        context="kind-dev"
        namespace="default"
        selector={{ app: "web" }}
        podsForSelectorFn={podsForSelectorFn}
        podMetricsFn={podMetricsFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(screen.getAllByText("—").length).toBeGreaterThan(0); // CPU/Memory blank
  });
});
