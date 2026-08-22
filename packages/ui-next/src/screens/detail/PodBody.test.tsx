import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { K8sObject } from "@srelens/core";
import { PodContainersBody, PodDetailsBody } from "./PodBody";

const APP_CONTAINER = {
  name: "app",
  image: "ghcr.io/example/app:1.2.3",
  ports: [{ name: "http", containerPort: 8080, protocol: "TCP" }],
  env: [{ name: "LOG_LEVEL", value: "info" }],
  volumeMounts: [{ name: "cache", mountPath: "/var/cache" }],
  livenessProbe: { httpGet: { path: "/healthz", port: 8080 }, periodSeconds: 10 },
  readinessProbe: { httpGet: { path: "/ready", port: 8080 } },
};

const APP_STATUS = {
  name: "app",
  ready: true,
  restartCount: 3,
  state: { running: { startedAt: "2026-08-20T00:00:00Z" } },
};

const SIDECAR_CONTAINER = {
  name: "sidecar",
  image: "ghcr.io/example/sidecar:1.0",
};

const SIDECAR_STATUS = {
  name: "sidecar",
  ready: true,
  restartCount: 0,
  state: { running: { startedAt: "2026-08-20T00:00:00Z" } },
};

function pod(spec: Record<string, unknown>, status: Record<string, unknown> = {}): K8sObject {
  return {
    kind: "Pod",
    apiVersion: "v1",
    metadata: { name: "web-1", namespace: "default" },
    spec,
    status,
  } as K8sObject;
}

describe("PodContainersBody", () => {
  it("names every container", () => {
    render(
      <PodContainersBody
        object={pod(
          { containers: [APP_CONTAINER, SIDECAR_CONTAINER] },
          { containerStatuses: [APP_STATUS, SIDECAR_STATUS] },
        )}
      />,
    );
    expect(screen.getByText("app")).toBeDefined();
    expect(screen.getByText("sidecar")).toBeDefined();
  });

  it("shows a container's state and its restart count", () => {
    render(
      <PodContainersBody
        object={pod({ containers: [APP_CONTAINER] }, { containerStatuses: [APP_STATUS] })}
      />,
    );
    // containerStateText({running: {...}, ready: true}) -> "running, ready"
    expect(screen.getByText("running, ready")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("shows ports, probes, environment and mounts for a container that has them", () => {
    render(
      <PodContainersBody
        object={pod({ containers: [APP_CONTAINER] }, { containerStatuses: [APP_STATUS] })}
      />,
    );
    expect(screen.getByText("Ports")).toBeDefined();
    expect(screen.getByText("http: 8080/TCP")).toBeDefined();
    expect(screen.getByText("Environment")).toBeDefined();
    expect(screen.getByText("LOG_LEVEL=info")).toBeDefined();
    expect(screen.getByText("Mounts")).toBeDefined();
    expect(screen.getByText("/var/cache ← cache")).toBeDefined();
    expect(screen.getByText("Liveness")).toBeDefined();
    expect(screen.getByText("Readiness")).toBeDefined();
    expect(screen.queryByText("Startup")).toBeNull();
  });

  it("omits ports, probes, environment and mounts for a container that has none", () => {
    render(
      <PodContainersBody
        object={pod({ containers: [SIDECAR_CONTAINER] }, { containerStatuses: [SIDECAR_STATUS] })}
      />,
    );
    expect(screen.getByText("sidecar")).toBeDefined();
    expect(screen.queryByText("Ports")).toBeNull();
    expect(screen.queryByText("Environment")).toBeNull();
    expect(screen.queryByText("Mounts")).toBeNull();
    expect(screen.queryByText("Liveness")).toBeNull();
    expect(screen.queryByText("Readiness")).toBeNull();
    expect(screen.queryByText("Startup")).toBeNull();
  });

  it("shows No containers when the pod has none", () => {
    render(<PodContainersBody object={pod({})} />);
    expect(screen.getByText("No containers")).toBeDefined();
  });
});

describe("PodDetailsBody", () => {
  it("shows conditions in the order orderPodConditions gives, not API order", () => {
    render(
      <PodDetailsBody
        object={pod(
          {},
          {
            conditions: [
              { type: "Ready", status: "True", lastTransitionTime: "2026-08-20T00:03:00Z" },
              { type: "PodScheduled", status: "True", lastTransitionTime: "2026-08-20T00:00:00Z" },
              { type: "ContainersReady", status: "True", lastTransitionTime: "2026-08-20T00:02:00Z" },
              { type: "Initialized", status: "True", lastTransitionTime: "2026-08-20T00:01:00Z" },
            ],
          },
        )}
      />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items).toHaveLength(4);
    expect(items[0]).toContain("PodScheduled");
    expect(items[1]).toContain("Initialized");
    expect(items[2]).toContain("ContainersReady");
    expect(items[3]).toContain("Ready");
  });

  it("shows No conditions when the pod reports none", () => {
    render(<PodDetailsBody object={pod({}, {})} />);
    expect(screen.getByText("No conditions")).toBeDefined();
  });
});
