import { describe, it, expect, vi } from "vitest";
import { listStatefulSets, listDaemonSets, listJobs, listCronJobs } from "./controllers";

describe("listStatefulSets", () => {
  it("passes context+namespace and returns rows", async () => {
    const invoke = vi.fn().mockResolvedValue({
      statefulsets: [{ name: "pg", namespace: "data", ready: "2/3", updated: 3, service: "pg-headless", age: "5d" }],
    });
    const out = await listStatefulSets("kind-dev", "data", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.listStatefulSets", { context: "kind-dev", namespace: "data" });
    expect(out.statefulsets?.[0].service).toBe("pg-headless");
  });

  it("normalises errors", async () => {
    const out = await listStatefulSets("x", "y", () => Promise.reject(new Error("forbidden")));
    expect(out.error).toContain("forbidden");
    expect(out.statefulsets).toBeUndefined();
  });
});

describe("listDaemonSets", () => {
  it("returns node-coverage rows", async () => {
    const invoke = vi.fn().mockResolvedValue({
      daemonsets: [{ name: "fluentd", namespace: "logging", desired: 5, current: 5, ready: 4, upToDate: 5, available: 4, age: "1d" }],
    });
    const out = await listDaemonSets("kind-dev", "logging", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.listDaemonSets", { context: "kind-dev", namespace: "logging" });
    expect(out.daemonsets?.[0].ready).toBe(4);
  });
});

describe("listJobs", () => {
  it("returns completion+owner rows", async () => {
    const invoke = vi.fn().mockResolvedValue({
      jobs: [{ name: "backup-1", namespace: "ops", completions: "1/1", active: 0, failed: 0, duration: "2m", owner: "backup", age: "3h" }],
    });
    const out = await listJobs("kind-dev", "ops", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.listJobs", { context: "kind-dev", namespace: "ops" });
    expect(out.jobs?.[0].owner).toBe("backup");
  });
});

describe("listCronJobs", () => {
  it("returns schedule+suspend rows", async () => {
    const invoke = vi.fn().mockResolvedValue({
      cronjobs: [{ name: "nightly", namespace: "ops", schedule: "0 2 * * *", suspended: true, active: 0, lastSchedule: "2h", age: "9d" }],
    });
    const out = await listCronJobs("kind-dev", "ops", invoke);
    expect(invoke).toHaveBeenCalledWith("k8s.listCronJobs", { context: "kind-dev", namespace: "ops" });
    expect(out.cronjobs?.[0].suspended).toBe(true);
  });
});
