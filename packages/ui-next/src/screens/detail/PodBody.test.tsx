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

function pod(
  spec: Record<string, unknown>,
  status: Record<string, unknown> = {},
  metadata: NonNullable<K8sObject["metadata"]> = { name: "web-1", namespace: "default" },
): K8sObject {
  return {
    kind: "Pod",
    apiVersion: "v1",
    metadata,
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

  it("shows Running since as a distinct fact from Last restart", () => {
    const status = {
      name: "app",
      ready: true,
      restartCount: 2,
      state: { running: { startedAt: "2026-08-20T12:00:00Z" } },
      lastState: { terminated: { finishedAt: "2026-08-19T00:00:00Z" } },
    };
    render(
      <PodContainersBody
        object={pod({ containers: [APP_CONTAINER] }, { containerStatuses: [status] })}
      />,
    );
    expect(screen.getByText("Last restart")).toBeDefined();
    expect(screen.getByText("Running since")).toBeDefined();
    // containerLastRestartTime reads lastState (the previous run's
    // termination); Running since reads state.running.startedAt (the
    // current run) — two different timestamps, not the same fact twice.
    const lastRestartRow = screen.getByText("Last restart").closest("dl");
    const runningSinceRow = screen.getByText("Running since").closest("dl");
    expect(lastRestartRow?.textContent).not.toEqual(runningSinceRow?.textContent);
  });

  it("shows which container an ephemeral container is debugging", () => {
    const debugContainer = { name: "debugger", image: "busybox", targetContainerName: "app" };
    render(<PodContainersBody object={pod({ ephemeralContainers: [debugContainer] })} />);
    expect(screen.getByText("Ephemeral containers")).toBeDefined();
    expect(screen.getByText("debugger")).toBeDefined();
    expect(screen.getByText("Debugging")).toBeDefined();
    expect(screen.getByText("app")).toBeDefined();
  });

  it("shows a container's command and args", () => {
    const commandContainer = { ...APP_CONTAINER, command: ["/bin/sh", "-c"], args: ["sleep 3600"] };
    render(
      <PodContainersBody
        object={pod({ containers: [commandContainer] }, { containerStatuses: [APP_STATUS] })}
      />,
    );
    expect(screen.getByText("Command")).toBeDefined();
    expect(screen.getByText("/bin/sh -c sleep 3600")).toBeDefined();
  });

  it("omits Debugging and Command when a container has neither", () => {
    render(
      <PodContainersBody
        object={pod({ containers: [SIDECAR_CONTAINER] }, { containerStatuses: [SIDECAR_STATUS] })}
      />,
    );
    expect(screen.queryByText("Debugging")).toBeNull();
    expect(screen.queryByText("Command")).toBeNull();
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

  it("omits the Conditions panel when the pod reports none, but still shows Properties", () => {
    render(<PodDetailsBody object={pod({}, {})} />);
    expect(screen.queryByText("Conditions")).toBeNull();
    expect(screen.getByText("Properties")).toBeDefined();
  });

  describe("Properties", () => {
    const FULL_POD = pod(
      {
        nodeName: "node-a",
        serviceAccountName: "web-sa",
        priorityClassName: "high",
        runtimeClassName: "gvisor",
        imagePullSecrets: [{ name: "registry-creds" }],
      },
      {
        phase: "Running",
        podIP: "10.0.0.5",
        podIPs: [{ ip: "10.0.0.5" }, { ip: "fd00::5" }],
        qosClass: "Burstable",
        containerStatuses: [APP_STATUS],
      },
      {
        name: "web-1",
        namespace: "default",
        creationTimestamp: "2026-08-20T00:00:00Z",
        labels: { app: "web", tier: "frontend" },
        annotations: { "kubectl.kubernetes.io/note": "deployed via ci" },
        ownerReferences: [{ kind: "ReplicaSet", name: "web-abc123" }],
      },
    );

    it("shows every Properties fact, with cross-resource references rendered as plain text", () => {
      render(<PodDetailsBody object={FULL_POD} />);
      expect(screen.getByText("Properties")).toBeDefined();
      expect(screen.getByText("web-1")).toBeDefined();
      expect(screen.getByText("default")).toBeDefined();
      expect(screen.getByTitle("app=web")).toBeDefined();
      expect(screen.getByTitle("tier=frontend")).toBeDefined();
      expect(screen.getByTitle("kubectl.kubernetes.io/note=deployed via ci")).toBeDefined();
      expect(screen.getByText("ReplicaSet/web-abc123")).toBeDefined();
      expect(screen.getByText("Running")).toBeDefined();
      expect(screen.getByText("3")).toBeDefined(); // container restarts, summed from containerStatuses
      expect(screen.getAllByText("node-a").length).toBeGreaterThan(0);
      expect(screen.getByText("fd00::5")).toBeDefined(); // second Pod IP, from the list
      expect(screen.getByText("web-sa")).toBeDefined();
      expect(screen.getByText("high")).toBeDefined();
      expect(screen.getByText("gvisor")).toBeDefined();
      expect(screen.getByText("Secret/registry-creds")).toBeDefined();
      expect(screen.getByText("Burstable")).toBeDefined();

      // Namespace, Node, Service account, Priority class, Runtime class and
      // Controlled by are `ResourceLink`s in classic; nothing here can
      // navigate (see the task report), so none of it renders as a
      // navigation control. Scoped to "Open ..." (classic's ResourceLink
      // aria-label) rather than a bare button query, since Table's own
      // column-sort buttons are a legitimate control, not a link.
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits absent Properties facts rather than showing them empty", () => {
      const bare = pod({}, {}, { name: "bare-1", namespace: "default" });
      render(<PodDetailsBody object={bare} />);
      expect(screen.getByText("Properties")).toBeDefined();
      expect(screen.getByText("bare-1")).toBeDefined();
      expect(screen.queryByText("Labels")).toBeNull();
      expect(screen.queryByText("Annotations")).toBeNull();
      expect(screen.queryByText("Controlled by")).toBeNull();
      expect(screen.queryByText("Node")).toBeNull();
      expect(screen.queryByText("Pod IP")).toBeNull();
      expect(screen.queryByText("Pod IPs")).toBeNull();
      expect(screen.queryByText("Service account")).toBeNull();
      expect(screen.queryByText("Priority class")).toBeNull();
      expect(screen.queryByText("Runtime class")).toBeNull();
      expect(screen.queryByText("Image pull secrets")).toBeNull();
      expect(screen.queryByText("QoS class")).toBeNull();
    });
  });

  describe("Scheduling", () => {
    it("shows Scheduling facts when the pod has placement info", () => {
      const scheduled = pod(
        {
          nodeName: "node-b",
          nodeSelector: { disktype: "ssd" },
          affinity: { podAntiAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [{}] } },
          tolerations: [{ key: "dedicated", operator: "Equal", value: "gpu", effect: "NoSchedule" }],
        },
        {},
        { name: "web-2" },
      );
      render(<PodDetailsBody object={scheduled} />);
      expect(screen.getByText("Scheduling")).toBeDefined();
      // "node-b" is shown in both Properties and Scheduling, same as classic.
      expect(screen.getAllByText("node-b")).toHaveLength(2);
      expect(screen.getByTitle("disktype=ssd")).toBeDefined();
      expect(screen.getByText("Pod anti-affinity: 1 required")).toBeDefined();
      expect(screen.getByText("dedicated=gpu → NoSchedule")).toBeDefined();
      // Same inert-value check as Properties: nothing here can navigate.
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits the Scheduling panel when the pod has no placement info", () => {
      const unscheduled = pod({}, {}, { name: "web-3" });
      render(<PodDetailsBody object={unscheduled} />);
      expect(screen.queryByText("Scheduling")).toBeNull();
    });

    it("shows Not scheduled when the pod has placement info but no assigned node", () => {
      const pending = pod(
        {
          tolerations: [{ key: "dedicated", operator: "Equal", value: "gpu", effect: "NoSchedule" }],
        },
        {},
        { name: "web-6" },
      );
      render(<PodDetailsBody object={pending} />);
      expect(screen.getByText("Scheduling")).toBeDefined();
      expect(screen.getByText("Not scheduled")).toBeDefined();
      // Only one "Node" fact renders — Properties omits it too, since
      // spec.nodeName is unset.
      expect(screen.getByText("Node")).toBeDefined();
    });
  });

  describe("Pod Volumes", () => {
    it("shows each volume's name, type and source", () => {
      const withVolumes = pod(
        {
          volumes: [
            { name: "data", persistentVolumeClaim: { claimName: "data-pvc" } },
            { name: "cache", emptyDir: {} },
            { name: "creds", secret: { secretName: "app-creds" } },
          ],
        },
        {},
        { name: "web-4" },
      );
      render(<PodDetailsBody object={withVolumes} />);
      expect(screen.getByText("Pod Volumes")).toBeDefined();
      expect(screen.getByText("data")).toBeDefined();
      expect(screen.getByText("Persistent Volume Claim")).toBeDefined();
      expect(screen.getByText("PersistentVolumeClaim/data-pvc")).toBeDefined();
      expect(screen.getByText("cache")).toBeDefined();
      expect(screen.getByText("Empty Dir")).toBeDefined();
      expect(screen.getByText("Node temporary storage")).toBeDefined();
      expect(screen.getByText("creds")).toBeDefined();
      expect(screen.getByText("Secret/app-creds")).toBeDefined();
      // Same inert-value check as Properties and Scheduling: the Source
      // column names the PVC/Secret it points at without a way to open it.
      // (Table's own column-sort buttons are excluded on purpose — a real
      // control, just not a navigation one.)
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits the Pod Volumes panel when the pod has no volumes", () => {
      const noVolumes = pod({}, {}, { name: "web-5" });
      render(<PodDetailsBody object={noVolumes} />);
      expect(screen.queryByText("Pod Volumes")).toBeNull();
    });
  });
});
