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

/** The label column of one flat block, in the order it reads. `heading`
 *  names the block; without one, the pane's first block — which the design
 *  heads with nothing at all. */
function factLabels(container: HTMLElement, heading?: string): string[] {
  const block = heading
    ? screen.getByRole("heading", { name: heading }).closest("section")
    : container.querySelector("section.section");
  return [...(block?.querySelectorAll(".kv-k") ?? [])].map((el) => el.textContent ?? "");
}

describe("PodDetailsBody", () => {
  const FULL_POD = pod(
    {
      containers: [APP_CONTAINER],
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

  describe("the fact list", () => {
    it("leads with what the design's own Pod frame leads with, and heads it with nothing", () => {
      // Status first, Created ninth — not classic's Created/Name/Namespace
      // opening. The extras srelens shows beyond the design frame sit beside
      // their own kin (Pod IPs after Pod IP, Last restart after Restarts)
      // rather than at the end.
      const { container } = render(<PodDetailsBody object={FULL_POD} />);
      expect(factLabels(container)).toEqual([
        "Status",
        "Node",
        "Pod IP",
        "Pod IPs",
        "QoS class",
        "Service account",
        "Priority class",
        "Runtime class",
        "Image pull secrets",
        "Containers ready",
        "Restarts",
        "Controlled by",
        "Namespace",
        "Created",
        "Image",
      ]);
      // No heading over the first block: the pane's header has already said
      // which pod this is.
      expect(screen.queryByRole("heading", { name: "Properties" })).toBeNull();
    });

    it("shows the pod's image, which used to live only on the Containers pane", () => {
      render(<PodDetailsBody object={FULL_POD} />);
      expect(screen.getByText("Image")).toBeDefined();
      expect(screen.getByText("ghcr.io/example/app:1.2.3")).toBeDefined();
    });

    it("names every image a multi-container pod runs, not just the first", () => {
      render(
        <PodDetailsBody
          object={pod({ containers: [APP_CONTAINER, SIDECAR_CONTAINER] }, {}, { name: "web-1" })}
        />,
      );
      expect(screen.getByText("ghcr.io/example/app:1.2.3")).toBeDefined();
      expect(screen.getByText("ghcr.io/example/sidecar:1.0")).toBeDefined();
    });

    it("counts the containers that are ready", () => {
      render(<PodDetailsBody object={FULL_POD} />);
      expect(screen.getByText("Containers ready")).toBeDefined();
      expect(screen.getByText("1 of 1")).toBeDefined();
    });

    it("omits the ready count while the kubelet has reported no container statuses", () => {
      // "0 of 0" would read as a fact where there is only an absence.
      render(<PodDetailsBody object={pod({ containers: [APP_CONTAINER] }, { phase: "Pending" })} />);
      expect(screen.queryByText("Containers ready")).toBeNull();
    });

    it("says Restarts, the word the design uses", () => {
      render(<PodDetailsBody object={FULL_POD} />);
      expect(screen.getByText("Restarts")).toBeDefined();
      expect(screen.queryByText("Container restarts")).toBeNull();
      expect(screen.getByText("3")).toBeDefined();
    });

    it("drops the Name row, which repeated the pane's own header", () => {
      const { container } = render(<PodDetailsBody object={FULL_POD} />);
      expect(factLabels(container)).not.toContain("Name");
      expect(screen.queryByText("web-1")).toBeNull();
    });

    it("reads Created as an age alone", () => {
      render(<PodDetailsBody object={FULL_POD} />);
      const created = screen.getByText("Created").closest("dl");
      expect(created?.textContent).toMatch(/^Created\d/);
      expect(created?.textContent).not.toMatch(/\(/);
    });

    it("takes the status word from core's one reading, so the header cannot contradict it", () => {
      // A pod whose container is in CrashLoopBackOff still reports phase
      // "Running"; `resourceStatusLine` is what the header reads too.
      render(
        <PodDetailsBody
          object={pod(
            { containers: [APP_CONTAINER] },
            {
              phase: "Running",
              containerStatuses: [{ name: "app", ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff" } } }],
            },
          )}
        />,
      );
      expect(screen.getByText("CrashLoopBackOff")).toBeDefined();
      expect(screen.queryByText("Running")).toBeNull();
    });

    it("shows the remaining facts as plain text, with nothing that navigates", () => {
      render(<PodDetailsBody object={FULL_POD} />);
      expect(screen.getByText("default")).toBeDefined();
      expect(screen.getByText("ReplicaSet/web-abc123")).toBeDefined();
      expect(screen.getAllByText("node-a").length).toBeGreaterThan(0);
      expect(screen.getByText("fd00::5")).toBeDefined();
      expect(screen.getByText("web-sa")).toBeDefined();
      expect(screen.getByText("high")).toBeDefined();
      expect(screen.getByText("gvisor")).toBeDefined();
      expect(screen.getByText("Secret/registry-creds")).toBeDefined();
      expect(screen.getByText("Burstable")).toBeDefined();
      // Namespace, Node, Service account, Priority class, Runtime class and
      // Controlled by are `ResourceLink`s in classic; nothing here can
      // navigate (see the task report).
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits absent facts rather than showing them empty", () => {
      const bare = pod({}, {}, { name: "bare-1", namespace: "default" });
      const { container } = render(<PodDetailsBody object={bare} />);
      expect(factLabels(container)).toEqual(["Status", "Namespace"]);
    });

    it("is a flat run of blocks, not a stack of cards", () => {
      const { container } = render(<PodDetailsBody object={FULL_POD} />);
      expect(container.querySelector(".card")).toBeNull();
      expect(container.querySelectorAll("section.section").length).toBeGreaterThan(1);
    });
  });

  /**
   * Labels and Annotations are no longer this body's, and the pane they are
   * drawn on is where they are pinned now — `ResourceDetailView.test`'s "Labels
   * and Annotations, which the host places". They moved because the two hosts
   * lay them out differently (the peek stacks them, the full tab reads them
   * side by side) and a body that rendered its own could only ever produce
   * one of those. The Secret gate moved with them, whole.
   */
  describe("Labels and Annotations", () => {
    it("renders neither, so the host can place them", () => {
      render(<PodDetailsBody object={FULL_POD} />);
      expect(screen.queryByRole("heading", { name: "Labels" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Annotations" })).toBeNull();
    });
  });

  describe("Conditions", () => {
    it("shows the pod's own conditions in lifecycle order, through the one shared block", () => {
      const { container } = render(
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
      expect(factLabels(container, "Conditions")).toEqual([
        "PodScheduled",
        "Initialized",
        "ContainersReady",
        "Ready",
      ]);
      // The shared block's form: status and reason as one value, no
      // last-transition column.
      expect(screen.getAllByText("True · —")).toHaveLength(4);
    });

    it("omits the Conditions block when the pod reports none, and still shows the facts", () => {
      const { container } = render(<PodDetailsBody object={pod({}, {})} />);
      expect(screen.queryByText("Conditions")).toBeNull();
      expect(factLabels(container)).toContain("Status");
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
      expect(screen.getByRole("heading", { name: "Scheduling" })).toBeDefined();
      // "node-b" is shown in both the fact list and Scheduling, same as classic.
      expect(screen.getAllByText("node-b")).toHaveLength(2);
      expect(screen.getByText("disktype=")).toBeDefined();
      expect(screen.getByText("ssd")).toBeDefined();
      expect(screen.getByText("Pod anti-affinity: 1 required")).toBeDefined();
      expect(screen.getByText("dedicated=gpu → NoSchedule")).toBeDefined();
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits the Scheduling block when the pod has no placement info", () => {
      render(<PodDetailsBody object={pod({}, {}, { name: "web-3" })} />);
      expect(screen.queryByText("Scheduling")).toBeNull();
    });

    it("shows Not scheduled when the pod has placement info but no assigned node", () => {
      const pending = pod(
        { tolerations: [{ key: "dedicated", operator: "Equal", value: "gpu", effect: "NoSchedule" }] },
        {},
        { name: "web-6" },
      );
      render(<PodDetailsBody object={pending} />);
      expect(screen.getByRole("heading", { name: "Scheduling" })).toBeDefined();
      expect(screen.getByText("Not scheduled")).toBeDefined();
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
      expect(screen.getByRole("heading", { name: "Pod Volumes" })).toBeDefined();
      expect(screen.getByText("data")).toBeDefined();
      expect(screen.getByText("Persistent Volume Claim")).toBeDefined();
      expect(screen.getByText("PersistentVolumeClaim/data-pvc")).toBeDefined();
      expect(screen.getByText("cache")).toBeDefined();
      expect(screen.getByText("Empty Dir")).toBeDefined();
      expect(screen.getByText("Node temporary storage")).toBeDefined();
      expect(screen.getByText("creds")).toBeDefined();
      expect(screen.getByText("Secret/app-creds")).toBeDefined();
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("omits the Pod Volumes block when the pod has no volumes", () => {
      render(<PodDetailsBody object={pod({}, {}, { name: "web-5" })} />);
      expect(screen.queryByText("Pod Volumes")).toBeNull();
    });
  });
});
