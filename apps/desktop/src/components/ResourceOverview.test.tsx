import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
// Workload relations fetch their own data; stub them so the overview tests
// stay focused on the Properties rendering (they have their own test file).
vi.mock("./WorkloadRelations", () => ({
  DeployRevisions: () => <div data-testid="deploy-revisions" />,
  ManagedPods: () => <div data-testid="managed-pods" />,
  CronJobJobs: () => <div data-testid="cronjob-jobs" />,
}));
vi.mock("./MetricsPanel", () => ({ MetricsPanel: () => <div data-testid="metrics" /> }));

import {
  ResourceOverview,
  ObjectDetail,
  ageFromTimestamp,
  containerLastRestartTime,
} from "./ResourceOverview";
import type { K8sObject } from "../lib/manifest";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const TLS_CERTIFICATE = "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSURPakNDQWlLZ0F3SUJBZ0lVSjVQdnk1NXRIbUhESkd3elhNVld2YnV4ck5nd0RRWUpLb1pJaHZjTkFRRUwKQlFBd0Z6RVZNQk1HQTFVRUF3d01aWGhoYlhCc1pTNTBaWE4wTUI0WERUSTJNRGN3TmpFeE1qazFOVm9YRFRNMgpNRGN3TXpFeE1qazFOVm93RnpFVk1CTUdBMVVFQXd3TVpYaGhiWEJzWlM1MFpYTjBNSUlCSWpBTkJna3Foa2lHCjl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUFzeFc2aHU0MVVwYittNXpHZm5aZ2tpT0xuaVhYTmhPYzhvTWgKaFZCcDVXL0Y5aXluelBGQjRGM0NOK2VlaEp1aVhYWHVFUWdQUVFqOVIrV3ErYlBUK1JPOHd6cEJqQ1BYaHo1TAp2Z0dzNDR1cXBQQ2JvUXVpV0RYcmZDWWtUT2xyd0tIZWJDcVRRM2FQUk1hUGk0YkhzRHdNdmlUcDRhMERGVTFWCkhGc2RXcHM0Uis3TG1MSXBhU3RUTTV1bU1qSC9FTzJGZ2psQmhYUUVGT1M0UnZ2WGpoV0E1ZGZiMEtwNUVSNFIKZjFGdktCRTNaTzVmbG5ldlFlTGdyMnZZT2Jhalg5OTQ1NVE0L1UwMTJJZG1ldWV4L2Q1ZU5VV0VNelprZzlrUQp1U00vMFpwbkhEVFU4UXZQTHh0Qy9jSlU1ekdKMzM0ZnppTGVmQUlpbDR2NFRvVzBQd0lEQVFBQm8zNHdmREFkCkJnTlZIUTRFRmdRVWxadEVndTl1L3ZTTVptSmNNa2RUcWhWVmJDSXdId1lEVlIwakJCZ3dGb0FVbFp0RWd1OXUKL3ZTTVptSmNNa2RUcWhWVmJDSXdEd1lEVlIwVEFRSC9CQVV3QXdFQi96QXBCZ05WSFJFRUlqQWdnZ3hsZUdGdApjR3hsTG5SbGMzU0NFSGQzZHk1bGVHRnRjR3hsTG5SbGMzUXdEUVlKS29aSWh2Y05BUUVMQlFBRGdnRUJBR2svCnp6cGhUNnRuNCtxUXg5Ly9meWNkSzFtNjg1eW1TRFZqT3ZXeWRQaWg4RzI4OUJkQ1BmYlc4ZVVrOXJqakJVZWcKR1k5OUJMcEhvcW9zZDNVWEhOUDJzWUdnZ0dZOG40QXdSbFFWZi9qajBPenVWUzZpS0FDM1ZXWFBtdGk5Q1JQZwpHVkdaR0VZMWI1SXYwVStaSzBjYlJ6c1NSN0FBN05VWGhTUUg0NjJDQlpJa1JSTXNFcVhSV2huUG5Kd3phLzJJCmJ1REdiTG1WMmhRUTdJeWJtb0FpL1FQVUM5WldrMExOV2pGYlpDa0kvem4wd2QxWVhham1iTHBSV0dsTjR1LzcKL2NDSER6NDNyWTZXeHJNRjVwYkJ5aWcvWk5obUVZK25rSFhwK2ZoRFdZOGV1QVVxT1p4bUQrNFIzL2lPQ2dhYgpsVWMzUnNCdmExVjNSbFB6K0pvPQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tCg==";

describe("ageFromTimestamp", () => {
  it("formats seconds, minutes, hours, and days", () => {
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 30_000)).toBe("30s");
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 5 * 60_000)).toBe("5m");
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 3 * 3_600_000)).toBe("3h");
    expect(ageFromTimestamp("2026-01-01T00:00:00Z", NOW + 2 * 86_400_000)).toBe("2d");
  });

  it("returns a dash for missing or invalid input", () => {
    expect(ageFromTimestamp(undefined, NOW)).toBe("—");
    expect(ageFromTimestamp("not-a-date", NOW)).toBe("—");
  });
});

describe("containerLastRestartTime", () => {
  it("uses the previous termination time only for restarted containers", () => {
    expect(
      containerLastRestartTime({
        restartCount: 2,
        lastState: { terminated: { finishedAt: "2025-12-31T23:55:00Z" } },
      }),
    ).toBe("2025-12-31T23:55:00Z");
    expect(containerLastRestartTime({ restartCount: 0, lastState: {} })).toBe("");
  });
});

const podObject: K8sObject = {
  kind: "Pod",
  metadata: {
    name: "web-1",
    namespace: "default",
    creationTimestamp: "2025-12-31T00:00:00Z",
    labels: { app: "web", tier: "frontend" },
    annotations: { "kubectl.kubernetes.io/restartedAt": "yesterday" },
    ownerReferences: [{ kind: "ReplicaSet", name: "web-abc" }],
  },
  spec: {
    nodeName: "node-a",
    serviceAccountName: "default",
    containers: [{ name: "nginx", image: "nginx:1.27" }],
  },
  status: {
    phase: "Running",
    podIP: "10.1.2.3",
    qosClass: "BestEffort",
    containerStatuses: [
      {
        name: "nginx",
        ready: true,
        restartCount: 2,
        state: { running: { startedAt: "2025-12-31T23:56:00Z" } },
        lastState: { terminated: { finishedAt: "2025-12-31T23:55:00Z", exitCode: 137 } },
      },
    ],
    conditions: [{ type: "Ready", status: "True", lastTransitionTime: "2025-12-31T00:00:00Z" }],
  },
};

describe("ObjectDetail (Pod)", () => {
  it("renders properties, status, containers, and conditions", () => {
    render(<ObjectDetail kind="Pod" obj={podObject} now={NOW} />);

    // properties
    expect(screen.getByText("web-1")).toBeDefined();
    expect(screen.getByText("ReplicaSet/web-abc")).toBeDefined();
    // labels collapse to a count
    expect(screen.getByText("2 Labels")).toBeDefined();
    // pod status + IP + QoS
    expect(screen.getByText("10.1.2.3")).toBeDefined();
    expect(screen.getByText("BestEffort")).toBeDefined();
    // container card
    expect(screen.getByText("nginx:1.27")).toBeDefined();
    expect(screen.getByText("running, ready")).toBeDefined();
    expect(screen.getByText("Container restarts")).toBeDefined();
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(screen.getAllByText(/5m ago/)).toHaveLength(2);
    expect(screen.getByText(/4m ago/)).toBeDefined();
    // conditions row + badge
    expect(screen.getByText("Conditions")).toBeDefined();
    expect(screen.getByText("Ready")).toBeDefined();
  });

  it("expands labels on click", () => {
    render(<ObjectDetail kind="Pod" obj={podObject} now={NOW} />);
    expect(screen.queryByText("frontend")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /2 Labels/ }));
    expect(screen.getByText("tier")).toBeDefined();
    expect(screen.getByText("frontend")).toBeDefined();
  });

  it("shows real volume sources and opens linked resources", () => {
    const onOpenResource = vi.fn();
    const pod: K8sObject = {
      ...podObject,
      spec: {
        ...podObject.spec,
        volumes: [
          { name: "data", persistentVolumeClaim: { claimName: "web-data" } },
          { name: "settings", configMap: { name: "web-config" } },
          { name: "scratch", emptyDir: {} },
        ],
      },
    };
    render(
      <ObjectDetail
        kind="Pod"
        obj={pod}
        now={NOW}
        context="kind-dev"
        onOpenResource={onOpenResource}
      />,
    );

    expect(screen.getByText("Pod Volumes")).toBeDefined();
    expect(screen.getByText("Persistent Volume Claim")).toBeDefined();
    expect(screen.getByText("Node temporary storage")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open PersistentVolumeClaim web-data" }));
    expect(onOpenResource).toHaveBeenCalledWith({
      kind: "PersistentVolumeClaim",
      namespace: "default",
      name: "web-data",
    });
  });

  it("collapses and expands long container commands", () => {
    const pod: K8sObject = {
      ...podObject,
      spec: {
        ...podObject.spec,
        containers: [
          {
            name: "nginx",
            image: "nginx:1.27",
            command: ["/bin/sh", "-c"],
            args: ["line one\nline two\nline three\nline four\nline five\nline six"],
          },
        ],
      },
    };
    render(<ObjectDetail kind="Pod" obj={pod} now={NOW} />);
    const toggle = screen.getByRole("button", { name: "Show full command" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Collapse command" }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ObjectDetail (Deployment)", () => {
  it("renders replica summary, selector, and condition badges", () => {
    const dep: K8sObject = {
      kind: "Deployment",
      metadata: {
        name: "vault",
        namespace: "clavik-dev",
        creationTimestamp: "2025-12-31T00:00:00Z",
        labels: { a: "1" },
        ownerReferences: [{ kind: "HelmRelease", name: "clavik-dev" }],
      },
      spec: {
        replicas: 1,
        strategy: { type: "RollingUpdate" },
        selector: { matchLabels: { "app.kubernetes.io/name": "vault" } },
      },
      status: {
        replicas: 1,
        updatedReplicas: 1,
        availableReplicas: 1,
        conditions: [
          { type: "Progressing", status: "True" },
          { type: "Available", status: "True" },
        ],
      },
    };
    render(<ObjectDetail kind="Deployment" obj={dep} now={NOW} />);
    expect(screen.getByText("1 desired, 1 updated, 1 total, 1 available, 0 unavailable")).toBeDefined();
    expect(screen.getByText("RollingUpdate")).toBeDefined();
    expect(screen.getByText("HelmRelease/clavik-dev")).toBeDefined();
    expect(screen.getByText("Progressing")).toBeDefined();
    expect(screen.getByText("Available")).toBeDefined();
    expect(screen.getByText("Running")).toBeDefined();
  });
});

describe("ObjectDetail (workload kinds)", () => {
  it("shows Job timing (started, completed, duration)", () => {
    const job: K8sObject = {
      kind: "Job",
      metadata: { name: "backup", namespace: "ops" },
      spec: { completions: 1 },
      status: {
        succeeded: 1,
        startTime: "2026-01-01T10:00:00Z",
        completionTime: "2026-01-01T10:02:30Z",
      },
    };
    render(<ObjectDetail kind="Job" obj={job} now={NOW} />);
    expect(screen.getByText("Started")).toBeDefined();
    expect(screen.getByText("Completed")).toBeDefined();
    expect(screen.getByText("Duration")).toBeDefined();
    // 150s → "2m 30s"
    expect(screen.getByText("2m 30s")).toBeDefined();
  });

  it("shows a StatefulSet's service, update strategy, and partition", () => {
    const sts: K8sObject = {
      kind: "StatefulSet",
      metadata: { name: "pg", namespace: "data" },
      spec: {
        replicas: 3,
        serviceName: "pg-headless",
        selector: { matchLabels: { app: "pg" } },
        updateStrategy: { type: "RollingUpdate", rollingUpdate: { partition: 2 } },
        volumeClaimTemplates: [{ metadata: { name: "data" } }, { metadata: { name: "wal" } }],
      },
      status: { replicas: 3, readyReplicas: 2, updatedReplicas: 3 },
    };
    render(<ObjectDetail kind="StatefulSet" obj={sts} now={NOW} />);
    expect(screen.getByText("pg-headless")).toBeDefined();
    expect(screen.getByText("RollingUpdate (partition 2)")).toBeDefined();
    // volume claim template names
    expect(screen.getByText("data, wal")).toBeDefined();
  });

  it("shows a CronJob's history limits and last schedule", () => {
    const cj: K8sObject = {
      kind: "CronJob",
      metadata: { name: "nightly", namespace: "ops" },
      spec: {
        schedule: "0 2 * * *",
        suspend: false,
        concurrencyPolicy: "Forbid",
        successfulJobsHistoryLimit: 3,
        failedJobsHistoryLimit: 1,
      },
      status: { lastScheduleTime: "2026-01-01T02:00:00Z" },
    };
    render(<ObjectDetail kind="CronJob" obj={cj} now={NOW} />);
    expect(screen.getByText("History (kept)")).toBeDefined();
    expect(screen.getByText("3 succeeded, 1 failed")).toBeDefined();
    expect(screen.getByText("Last schedule")).toBeDefined();
  });

  it("shows a DaemonSet's update strategy", () => {
    const ds: K8sObject = {
      kind: "DaemonSet",
      metadata: { name: "fluentd", namespace: "logging" },
      spec: { updateStrategy: { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 1 } } },
      status: { desiredNumberScheduled: 5, numberReady: 5 },
    };
    render(<ObjectDetail kind="DaemonSet" obj={ds} now={NOW} />);
    expect(screen.getByText("Update strategy")).toBeDefined();
    expect(screen.getByText("RollingUpdate (max unavailable 1)")).toBeDefined();
  });
});

describe("ObjectDetail (ConfigMap / Secret)", () => {
  it("shows ConfigMap values inline", () => {
    const cm: K8sObject = {
      kind: "ConfigMap",
      metadata: { name: "cm", namespace: "default" },
      data: { "app.conf": "level=info" },
    };
    render(<ObjectDetail kind="ConfigMap" obj={cm} now={NOW} />);
    expect(screen.getByText("app.conf")).toBeDefined();
    expect(screen.getByText("level=info")).toBeDefined();
  });

  it("masks Secret values until revealed (base64-decoded)", () => {
    const secret: K8sObject = {
      kind: "Secret",
      metadata: { name: "s", namespace: "default" },
      data: { token: "aGVsbG8=" }, // "hello"
    };
    render(<ObjectDetail kind="Secret" obj={secret} now={NOW} />);
    expect(screen.getByText("••••••••")).toBeDefined();
    expect(screen.queryByText("hello")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("shows parsed TLS certificate metadata without revealing material", async () => {
    const secret: K8sObject = {
      kind: "Secret",
      type: "kubernetes.io/tls",
      metadata: { name: "web-tls", namespace: "default" },
      data: {
        "tls.crt": TLS_CERTIFICATE,
        "tls.key": btoa("-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----"),
      },
    };
    render(<ObjectDetail kind="Secret" obj={secret} now={NOW} />);
    expect(screen.getByText("TLS material")).toBeDefined();
    expect(screen.getByText("PKCS#8")).toBeDefined();
    await waitFor(() => expect(screen.getAllByText(/example\.test/).length).toBeGreaterThan(0));
    expect(screen.getByText("www.example.test")).toBeDefined();
    expect(screen.queryByText("private")).toBeNull();
  });

  it("summarises Docker registries without exposing passwords", () => {
    const dockerConfig = JSON.stringify({
      auths: {
        "registry.example.com": { username: "robot", password: "s3cr3t" },
      },
    });
    const secret: K8sObject = {
      kind: "Secret",
      type: "kubernetes.io/dockerconfigjson",
      metadata: { name: "registry", namespace: "default" },
      data: { ".dockerconfigjson": btoa(dockerConfig) },
    };
    render(<ObjectDetail kind="Secret" obj={secret} now={NOW} />);
    expect(screen.getByText("registry.example.com")).toBeDefined();
    expect(screen.getByText("robot")).toBeDefined();
    expect(screen.getByText("Stored")).toBeDefined();
    expect(screen.queryByText("s3cr3t")).toBeNull();
  });
});

describe("ObjectDetail (more kinds)", () => {
  it("renders Ingress rules", () => {
    const ing: K8sObject = {
      kind: "Ingress",
      metadata: { name: "web", namespace: "default" },
      spec: {
        ingressClassName: "nginx",
        rules: [
          { host: "app.example.com", http: { paths: [{ path: "/", backend: { service: { name: "web", port: { number: 80 } } } }] } },
        ],
      },
    };
    render(<ObjectDetail kind="Ingress" obj={ing} now={NOW} />);
    expect(screen.getByText("app.example.com")).toBeDefined();
    expect(screen.getByText("web:80")).toBeDefined();
  });

  it("renders Role rules", () => {
    const role: K8sObject = {
      kind: "Role",
      metadata: { name: "r", namespace: "default" },
      rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
    };
    render(<ObjectDetail kind="Role" obj={role} now={NOW} />);
    expect(screen.getByText("pods")).toBeDefined();
    expect(screen.getByText("get, list")).toBeDefined();
  });

  it("renders ResourceQuota used/hard", () => {
    const rq: K8sObject = {
      kind: "ResourceQuota",
      metadata: { name: "q", namespace: "default" },
      status: { hard: { "limits.cpu": "4" }, used: { "limits.cpu": "1" } },
    };
    render(<ObjectDetail kind="ResourceQuota" obj={rq} now={NOW} />);
    expect(screen.getByText("limits.cpu")).toBeDefined();
  });

  it("offers an inline port-forward on Service ports when a context is given", () => {
    const svc: K8sObject = {
      kind: "Service",
      metadata: { name: "web", namespace: "default" },
      spec: {
        type: "ClusterIP",
        selector: { app: "web" },
        ports: [{ name: "http", port: 80, targetPort: 8080, protocol: "TCP" }],
      },
    };
    render(<ObjectDetail kind="Service" obj={svc} now={NOW} context="kind-dev" />);
    expect(screen.getByRole("button", { name: "Forward port 80" })).toBeDefined();
  });

  it("omits the Service forward button for selector-less (headless) services", () => {
    const svc: K8sObject = {
      kind: "Service",
      metadata: { name: "db", namespace: "default" },
      spec: { clusterIP: "None", ports: [{ port: 5432, targetPort: 5432 }] },
    };
    render(<ObjectDetail kind="Service" obj={svc} now={NOW} context="kind-dev" />);
    expect(screen.queryByRole("button", { name: /Forward port/ })).toBeNull();
  });

  it("offers an inline port-forward on Pod container ports", () => {
    const p: K8sObject = {
      kind: "Pod",
      metadata: { name: "web-1", namespace: "default" },
      spec: { containers: [{ name: "app", image: "img", ports: [{ containerPort: 8080 }] }] },
      status: {},
    };
    render(<ObjectDetail kind="Pod" obj={p} now={NOW} context="kind-dev" />);
    expect(screen.getByRole("button", { name: "Forward port 8080" })).toBeDefined();
  });

  it("expands a container's environment variables", () => {
    const p: K8sObject = {
      kind: "Pod",
      metadata: { name: "web-1", namespace: "default" },
      spec: { containers: [{ name: "app", image: "img", env: [{ name: "FOO", value: "bar" }] }] },
      status: {},
    };
    render(<ObjectDetail kind="Pod" obj={p} now={NOW} />);
    expect(screen.queryByText("FOO=bar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /environment variable/ }));
    expect(screen.getByText("FOO=bar")).toBeDefined();
  });
});

describe("ObjectDetail (storage links)", () => {
  it("links a claim to its volume and storage class", () => {
    const onOpenResource = vi.fn();
    const pvc: K8sObject = {
      kind: "PersistentVolumeClaim",
      metadata: { name: "data", namespace: "default" },
      spec: { volumeName: "pv-data", storageClassName: "fast", accessModes: ["ReadWriteOnce"] },
      status: { phase: "Bound", capacity: { storage: "10Gi" } },
    };
    render(
      <ObjectDetail
        kind="PersistentVolumeClaim"
        obj={pvc}
        now={NOW}
        onOpenResource={onOpenResource}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open PersistentVolume pv-data" }));
    expect(onOpenResource).toHaveBeenCalledWith({
      kind: "PersistentVolume",
      namespace: null,
      name: "pv-data",
    });
  });

  it("renders persistent-volume details and links back to its claim", () => {
    const onOpenResource = vi.fn();
    const pv: K8sObject = {
      kind: "PersistentVolume",
      metadata: { name: "pv-data" },
      spec: {
        capacity: { storage: "10Gi" },
        accessModes: ["ReadWriteOnce"],
        persistentVolumeReclaimPolicy: "Delete",
        storageClassName: "fast",
        claimRef: { namespace: "default", name: "data" },
        csi: { driver: "disk.csi.example" },
      },
      status: { phase: "Bound" },
    };
    render(
      <ObjectDetail
        kind="PersistentVolume"
        obj={pv}
        now={NOW}
        onOpenResource={onOpenResource}
      />,
    );
    expect(screen.getByText("10Gi")).toBeDefined();
    expect(screen.getByText("CSI")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open PersistentVolumeClaim data" }));
    expect(onOpenResource).toHaveBeenCalledWith({
      kind: "PersistentVolumeClaim",
      namespace: "default",
      name: "data",
    });
  });
});

describe("ObjectDetail (Service)", () => {
  it("renders connection details and ports", () => {
    const svc: K8sObject = {
      kind: "Service",
      metadata: { name: "web", namespace: "default" },
      spec: {
        type: "ClusterIP",
        clusterIP: "10.96.0.1",
        selector: { app: "web" },
        ports: [{ name: "http", port: 80, targetPort: 8080, protocol: "TCP" }],
      },
    };
    render(<ObjectDetail kind="Service" obj={svc} now={NOW} />);
    expect(screen.getByText("10.96.0.1")).toBeDefined();
    expect(screen.getByText("Ports")).toBeDefined();
    expect(screen.getByText("8080")).toBeDefined();
  });
});

describe("ResourceOverview", () => {
  it("fetches and renders the object", async () => {
    const getObjectFn = vi.fn().mockResolvedValue({ object: podObject });
    render(
      <ResourceOverview
        context="kind-dev"
        kind="Pod"
        namespace="default"
        name="web-1"
        getObjectFn={getObjectFn}
      />,
    );
    await waitFor(() => expect(screen.getByText("web-1")).toBeDefined());
    expect(getObjectFn).toHaveBeenCalledWith("kind-dev", "Pod", "default", "web-1");
  });

  it("shows an error when the fetch fails", async () => {
    const getObjectFn = vi.fn().mockResolvedValue({ error: "not found" });
    render(
      <ResourceOverview
        context="kind-dev"
        kind="Pod"
        namespace="default"
        name="missing"
        getObjectFn={getObjectFn}
      />,
    );
    await waitFor(() => expect(screen.getByText(/not found/)).toBeDefined());
  });

  it("re-fetches the object when reloadKey changes (after an action)", async () => {
    const getObjectFn = vi.fn().mockResolvedValue({ object: podObject });
    const { rerender } = render(
      <ResourceOverview
        context="kind-dev"
        kind="Pod"
        namespace="default"
        name="web-1"
        getObjectFn={getObjectFn}
        reloadKey={0}
      />,
    );
    await waitFor(() => expect(getObjectFn).toHaveBeenCalledTimes(1));

    rerender(
      <ResourceOverview
        context="kind-dev"
        kind="Pod"
        namespace="default"
        name="web-1"
        getObjectFn={getObjectFn}
        reloadKey={1}
      />,
    );
    await waitFor(() => expect(getObjectFn).toHaveBeenCalledTimes(2));
  });
});
