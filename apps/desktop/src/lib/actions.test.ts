import { describe, it, expect, vi } from "vitest";
import { deleteResource, scaleResource, rolloutRestart } from "./actions";

describe("resource actions", () => {
  it("deleteResource passes kind/namespace/name", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const out = await deleteResource("c", "ConfigMap", "default", "cm", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.deleteResource", {
      context: "c",
      kind: "ConfigMap",
      namespace: "default",
      name: "cm",
    });
    expect(out.ok).toBe(true);
  });

  it("scaleResource passes replicas", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    await scaleResource("c", "Deployment", "default", "web", 3, invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.scale", {
      context: "c",
      kind: "Deployment",
      namespace: "default",
      name: "web",
      replicas: 3,
    });
  });

  it("rolloutRestart passes target", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    await rolloutRestart("c", "Deployment", "default", "web", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.rolloutRestart", {
      context: "c",
      kind: "Deployment",
      namespace: "default",
      name: "web",
    });
  });

  it("normalises errors", async () => {
    const out = await deleteResource("c", "Pod", "default", "p", () =>
      Promise.reject(new Error("forbidden")),
    );
    expect(out.error).toContain("forbidden");
  });
});
