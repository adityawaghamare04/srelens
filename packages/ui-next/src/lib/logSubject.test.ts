import { describe, it, expect } from "vitest";
import type { Invoker } from "@srelens/core";
import { resolveLogSubject, type LogSubject } from "./logSubject";

/**
 * A pod object shaped like `k8s.getObject` returns for a Pod — the whole
 * object, because that is what the backend sends and what the resolution
 * reads its per-pod facts out of.
 */
const podObject = (
  containers: string[],
  extra: { labels?: Record<string, string>; status?: Record<string, unknown> } = {},
) => ({
  metadata: extra.labels ? { labels: extra.labels } : {},
  spec: { containers: containers.map((name) => ({ name })) },
  status: extra.status ?? { phase: "Running", containerStatuses: [{ ready: true, restartCount: 0 }] },
});

/** A workload object shaped like `k8s.getObject` returns for a Deployment. */
const workloadObject = (matchLabels: Record<string, string>) => ({
  spec: { selector: { matchLabels } },
});

/** A fake `invoke` that answers `k8s.getObject` / `k8s.podsForSelector` from
 *  fixed tables keyed by kind+name / by call order, so a test can hand back
 *  exactly what it needs without touching a cluster. */
function fakeInvoke(opts: {
  objects?: Record<string, unknown>;
  pods?: { pods?: { name: string }[] } | Error;
}): Invoker {
  return (async (id: string, input?: unknown): Promise<unknown> => {
    if (id === "k8s.getObject") {
      const { kind, name } = input as { kind: string; name: string };
      const key = `${kind}/${name}`;
      const object = opts.objects?.[key];
      if (object === undefined) throw new Error(`${kind} "${name}" not found`);
      return { object };
    }
    if (id === "k8s.podsForSelector") {
      if (opts.pods instanceof Error) throw opts.pods;
      return opts.pods ?? { pods: [] };
    }
    throw new Error(`unexpected capability ${id}`);
  }) as Invoker;
}

const podSubject: LogSubject = {
  type: "pod",
  context: "kind-dev",
  namespace: "default",
  name: "web-1",
};

const workloadSubject: LogSubject = {
  type: "workload",
  context: "kind-dev",
  namespace: "default",
  kind: "Deployment",
  name: "web",
};

describe("resolveLogSubject", () => {
  it("resolves a pod subject to itself, unlabelled", async () => {
    const invoke = fakeInvoke({ objects: { "Pod/web-1": podObject(["app"]) } });
    const result = await resolveLogSubject(podSubject, invoke);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.targets).toEqual([{ pod: "web-1", container: "app", label: "" }]);
  });

  it("resolves a workload subject through its selector to its pods", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app"]),
        "Pod/web-def": podObject(["app"]),
      },
      pods: { pods: [{ name: "web-abc" }, { name: "web-def" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.targets.map((t) => t.pod).sort()).toEqual(["web-abc", "web-def"]);
  });

  it("labels lines only when more than one target is in scope", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app", "sidecar"]),
      },
      pods: { pods: [{ name: "web-abc" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.targets).toHaveLength(2);
    expect(result.targets.every((t) => t.label && t.label.length > 0)).toBe(true);
    expect(result.targets.find((t) => t.container === "app")?.label).toBe("web-abc/app");
  });

  it("withholds targets until every pod's containers are known", async () => {
    let resolveSecond!: (v: unknown) => void;
    const secondPodPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    let secondPodRequested = false;
    const invoke = (async (id: string, input?: unknown): Promise<unknown> => {
      if (id === "k8s.podsForSelector") return { pods: [{ name: "web-abc" }, { name: "web-def" }] };
      if (id === "k8s.getObject") {
        const { kind, name } = input as { kind: string; name: string };
        if (kind === "Deployment") return { object: workloadObject({ app: "web" }) };
        if (name === "web-abc") return { object: podObject(["app"]) };
        if (name === "web-def") {
          secondPodRequested = true;
          return secondPodPromise.then(() => ({ object: podObject(["app"]) }));
        }
      }
      throw new Error(`unexpected call ${id}`);
    }) as Invoker;

    let settled = false;
    const pending = resolveLogSubject(workloadSubject, invoke).then((r) => {
      settled = true;
      return r;
    });

    // Flush a generous number of microtasks without letting the second pod's
    // getObject settle. Both must hold: the fetch was actually reached
    // (proving every in-scope pod's containers are asked for, not just the
    // first), and the overall resolution is still unsettled (proving it
    // waits on that fetch rather than returning early).
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(secondPodRequested).toBe(true);
    expect(settled).toBe(false);

    resolveSecond({});
    const result = await pending;
    expect(settled).toBe(true);
    expect(result.status).toBe("resolved");
  });

  it("says a workload with no pods has none, rather than resolving to an empty stream", async () => {
    const invoke = fakeInvoke({
      objects: { "Deployment/web": workloadObject({ app: "web" }) },
      pods: { pods: [] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    expect(result.status).toBe("empty");
    if (result.status !== "empty") throw new Error("expected empty");
    expect(result.detail).toContain("Deployment/web");
  });

  it("says a workload whose pods exist but have no app container is empty, not resolved to nothing", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        // The pod exists and answers, but has no app container to follow —
        // e.g. every container it does have is an init container.
        "Pod/web-abc": podObject([]),
      },
      pods: { pods: [{ name: "web-abc" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    expect(result.status).toBe("empty");
    if (result.status !== "empty") throw new Error("expected empty");
    expect(result.detail).toContain("Deployment/web");
  });

  it("labels lines with the pod alone when every target shares one container name", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app"]),
        "Pod/web-def": podObject(["app"]),
      },
      pods: { pods: [{ name: "web-abc" }, { name: "web-def" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.targets.map((t) => t.label).sort()).toEqual(["web-abc", "web-def"]);
  });

  it("reports a pod that has gone", async () => {
    const invoke = fakeInvoke({ objects: {} });
    const result = await resolveLogSubject(podSubject, invoke);
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    expect(result.error.detail.length).toBeGreaterThan(0);
  });

  it("fails the whole resolution, not a partial target list, when one pod's containers can't be read", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app"]),
        // "Pod/web-def" deliberately missing — its getObject call fails.
      },
      pods: { pods: [{ name: "web-abc" }, { name: "web-def" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    expect(result.status).toBe("error");
  });

  it("classifies a resolution failure through describeError rather than printing it raw", async () => {
    const invoke = fakeInvoke({
      objects: { "Deployment/web": workloadObject({ app: "web" }) },
      pods: new Error("unable to run auth exec: executable not found"),
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("expected error");
    // Not the generic fallback, and not the raw exec-plugin string verbatim —
    // describeError's exec-auth classification (jsdom has no
    // __TAURI_INTERNALS__, so this is the web-mode copy).
    expect(result.error.title).toBe("This cluster needs OIDC sign-in");
    expect(result.error.detail).not.toContain("executable not found");
  });
});

/**
 * The per-pod facts the Stream rail draws its Sources rows from. They ride
 * back on the resolution rather than costing a second round trip: the pod
 * objects are already fetched here, for their containers.
 */
describe("resolveLogSubject's pods", () => {
  const crashing = {
    phase: "Running",
    containerStatuses: [
      { ready: false, restartCount: 7, state: { waiting: { reason: "CrashLoopBackOff" } } },
    ],
  };

  it("reports a pod per pod in scope, on core's verdict rather than the phase", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app"]),
        // Phase still says Running — the whole reason `podStatus` reads the
        // waiting reason too. A rail keying off the phase would draw this
        // green.
        "Pod/web-def": podObject(["app"], { status: crashing }),
      },
      pods: { pods: [{ name: "web-abc" }, { name: "web-def" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.pods).toEqual([
      { name: "web-abc", health: "success" },
      { name: "web-def", health: "danger" },
    ]);
  });

  it("carries the pod-template-hash when the pod has one", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app"], { labels: { "pod-template-hash": "7d764666f9" } }),
      },
      pods: { pods: [{ name: "web-abc" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.pods[0].revision).toBe("7d764666f9");
  });

  it("omits the revision rather than carrying a blank one", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        // A DaemonSet's or a bare pod's labels: no pod-template-hash at all,
        // and one that is present but empty, which is the same absence.
        "Pod/web-abc": podObject(["app"], { labels: { app: "web" } }),
        "Pod/web-def": podObject(["app"], { labels: { "pod-template-hash": "" } }),
      },
      pods: { pods: [{ name: "web-abc" }, { name: "web-def" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.pods.every((p) => !("revision" in p))).toBe(true);
  });

  it("reports the one pod of a pod subject, which never touches podsForSelector", async () => {
    const seen: string[] = [];
    const inner = fakeInvoke({
      objects: { "Pod/web-1": podObject(["app"], { status: crashing }) },
    });
    const invoke = ((id: string, input?: unknown) => {
      seen.push(id);
      return inner(id, input as never);
    }) as Invoker;
    const result = await resolveLogSubject(podSubject, invoke);
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.pods).toEqual([{ name: "web-1", health: "danger" }]);
    expect(seen).not.toContain("k8s.podsForSelector");
  });

  it("names each pod once, however many containers it contributes", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app", "sidecar"]),
      },
      pods: { pods: [{ name: "web-abc" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.targets).toHaveLength(2);
    expect(result.pods.map((p) => p.name)).toEqual(["web-abc"]);
  });

  it("leaves out a pod that contributed no target, which no line can come from", async () => {
    const invoke = fakeInvoke({
      objects: {
        "Deployment/web": workloadObject({ app: "web" }),
        "Pod/web-abc": podObject(["app"]),
        // Init containers only: in scope, but nothing to follow, so a
        // checkbox for it would filter nothing at all.
        "Pod/web-def": podObject([]),
      },
      pods: { pods: [{ name: "web-abc" }, { name: "web-def" }] },
    });
    const result = await resolveLogSubject(workloadSubject, invoke);
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.pods.map((p) => p.name)).toEqual(["web-abc"]);
  });
});
