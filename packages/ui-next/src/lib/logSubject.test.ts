import { describe, it, expect } from "vitest";
import type { Invoker } from "@srelens/core";
import { resolveLogSubject, type LogSubject } from "./logSubject";

/** A pod object shaped like `k8s.getObject` returns for a Pod. */
const podObject = (containers: string[]) => ({
  spec: { containers: containers.map((name) => ({ name })) },
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
