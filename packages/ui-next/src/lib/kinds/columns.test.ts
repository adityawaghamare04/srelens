import { describe, it, expect } from "vitest";
import {
  podColumns,
  deploymentColumns,
  statefulSetColumns,
  daemonSetColumns,
  jobColumns,
  cronJobColumns,
  nodeColumns,
  configMapColumns,
  secretColumns,
  resourceQuotaColumns,
  limitRangeColumns,
  serviceColumns,
  ingressColumns,
  endpointSliceColumns,
  networkPolicyColumns,
  pvcColumns,
  pvColumns,
  storageClassColumns,
  serviceAccountColumns,
  roleColumns,
  clusterRoleColumns,
  roleBindingColumns,
  clusterRoleBindingColumns,
  podFlagged,
  deploymentFlagged,
  statefulSetFlagged,
  daemonSetFlagged,
  type PodRow,
} from "./columns";

/** Every typed column set columns.tsx exports — the design mock titles every
 *  one of these "Name", never the kind, and none of them may ask for a
 *  per-column funnel (the mock has one search box, not 23). */
const ALL_TYPED_SETS = [
  podColumns,
  deploymentColumns,
  statefulSetColumns,
  daemonSetColumns,
  jobColumns,
  cronJobColumns,
  nodeColumns,
  configMapColumns,
  secretColumns,
  resourceQuotaColumns,
  limitRangeColumns,
  serviceColumns,
  ingressColumns,
  endpointSliceColumns,
  networkPolicyColumns,
  pvcColumns,
  pvColumns,
  storageClassColumns,
  serviceAccountColumns,
  roleColumns,
  clusterRoleColumns,
  roleBindingColumns,
  clusterRoleBindingColumns,
];

const pod = (over: Partial<PodRow> = {}): PodRow => ({
  name: "web-0", namespace: "default", phase: "Running", ready: "1/1",
  restarts: 0, node: "node-a", age: "3d", ...over,
});

describe("pod columns", () => {
  it("sorts ages by duration, not by the text that renders them", () => {
    const age = podColumns.find((c) => c.key === "age")!;
    const older = age.getSortValue!(pod({ age: "1y" }));
    const newer = age.getSortValue!(pod({ age: "300d" }));
    expect(Number(older)).toBeGreaterThan(Number(newer));
  });

  it("shows an em dash where metrics-server left no reading, not a bare zero", () => {
    const cpu = podColumns.find((c) => c.key === "cpu")!;
    expect(cpu.render!(pod())).toBe("—");
    expect(cpu.render!(pod({ cpu: 12 }))).toBe("12m");
  });

  it("sorts a missing reading below every real one", () => {
    const cpu = podColumns.find((c) => c.key === "cpu")!;
    expect(Number(cpu.getSortValue!(pod()))).toBeLessThan(Number(cpu.getSortValue!(pod({ cpu: 0 }))));
  });

  it("groups a four-digit CPU reading with a thin space, not a bare run of digits", () => {
    const cpu = podColumns.find((c) => c.key === "cpu")!;
    expect(cpu.render!(pod({ cpu: 2410 }))).toBe("2 410m");
    expect(cpu.render!(pod({ cpu: 241 }))).toBe("241m");
  });

  it("puts a space before Mi, and scales at or above 1024 Mi to one-decimal Gi", () => {
    const memory = podColumns.find((c) => c.key === "memory")!;
    expect(memory.render!(pod({ memory: 988 }))).toBe("988 Mi");
    expect(memory.render!(pod({ memory: 412 }))).toBe("412 Mi");
    expect(memory.render!(pod({ memory: 3174 }))).toBe("3.1 Gi");
    expect(memory.render!(pod({ memory: 2969 }))).toBe("2.9 Gi");
  });

  it("sorts memory on the raw Mi value, never the Gi-scaled display text", () => {
    // The pair that breaks if the comparator is ever pointed at the rendered
    // string: "3.1 Gi" collates before "988 Mi" as text, backwards from the
    // 3174 Mi > 988 Mi it actually is.
    const memory = podColumns.find((c) => c.key === "memory")!;
    const gi = Number(memory.getSortValue!(pod({ memory: 3174 })));
    const mi = Number(memory.getSortValue!(pod({ memory: 988 })));
    expect(gi).toBeGreaterThan(mi);
    expect(gi).toBe(3174);
  });

  it("sorts a missing memory reading below every real one", () => {
    const memory = podColumns.find((c) => c.key === "memory")!;
    expect(Number(memory.getSortValue!(pod()))).toBeLessThan(Number(memory.getSortValue!(pod({ memory: 0 }))));
  });

  it("names the pod column Name, not the kind — the mock titles every list Name", () => {
    expect(podColumns[0].header).toBe("Name");
  });

  it("flags a pod that is not Running, and only that", () => {
    const running = { name: "web-0", namespace: "d", phase: "Running", ready: "1/1", restarts: 0, node: "n", age: "1d" };
    expect(podFlagged(running)).toBe(false);
    expect(podFlagged({ ...running, phase: "CrashLoopBackOff" })).toBe(true);
    expect(podFlagged({ ...running, phase: "Pending" })).toBe(true);
  });
});

describe("node columns", () => {
  it("keeps no namespace column, because a node has none", () => {
    expect(nodeColumns.some((c) => c.key === "namespace")).toBe(false);
  });

  it("formats CPU and memory exactly as pods do — the same two readings must not drift", () => {
    const cpu = nodeColumns.find((c) => c.key === "cpu")!;
    const memory = nodeColumns.find((c) => c.key === "memory")!;
    const node = {
      name: "n1", status: "Ready", roles: "worker", version: "1.30", age: "9d", taints: 0, unschedulable: false,
    };
    const withCpu = { ...node, cpu: 2410 };
    const withMemory = { ...node, memory: 3174 };
    expect(cpu.render!(withCpu)).toBe("2 410m");
    expect(memory.render!(withMemory)).toBe("3.1 Gi");
  });
});

describe("the rules every typed set follows", () => {
  it("shows a service's external IP, an em dash rather than a blank when it has none", () => {
    const external = serviceColumns.find((c) => c.key === "externalIP")!;
    expect(external.render!({ name: "s", namespace: "d", type: "ClusterIP", clusterIP: "10.0.0.1", externalIP: "", ports: "", age: "1d" })).toBe("—");
  });

  it("counts a secret's keys rather than showing them", () => {
    const keys = secretColumns.find((c) => c.key === "keys")!;
    expect(keys.render!({ name: "s", namespace: "d", type: "Opaque", keys: 3, age: "1d" })).toBe("3");
  });

  it("keeps no namespace column on a cluster-scoped kind", () => {
    expect(clusterRoleColumns.some((c) => c.key === "namespace")).toBe(false);
  });

  it("titles the identifier column Name for every one of the 23 typed sets", () => {
    for (const set of ALL_TYPED_SETS) {
      expect(set[0].key).toBe("name");
      expect(set[0].header).toBe("Name");
    }
  });

  it("asks for no per-column funnel anywhere — the mock has one search box, not 23", () => {
    for (const set of ALL_TYPED_SETS) {
      expect(set.some((c) => c.filterable)).toBe(false);
    }
  });
});

describe("flagged rows — the design's unhealthy dot, per kind", () => {
  it("flags a Deployment or StatefulSet whose ready count falls short of desired", () => {
    expect(deploymentFlagged({ name: "d", namespace: "ns", ready: "3/3", upToDate: 3, available: 3, age: "1d" })).toBe(false);
    expect(deploymentFlagged({ name: "d", namespace: "ns", ready: "2/3", upToDate: 3, available: 2, age: "1d" })).toBe(true);

    expect(statefulSetFlagged({ name: "s", namespace: "ns", ready: "1/1", updated: 1, service: "", age: "1d" })).toBe(false);
    expect(statefulSetFlagged({ name: "s", namespace: "ns", ready: "0/1", updated: 1, service: "", age: "1d" })).toBe(true);
  });

  it("flags a DaemonSet whose ready count falls short of desired", () => {
    const base = { name: "n", namespace: "ns", desired: 3, current: 3, upToDate: 3, available: 3, age: "1d" };
    expect(daemonSetFlagged({ ...base, ready: 3 })).toBe(false);
    expect(daemonSetFlagged({ ...base, ready: 2 })).toBe(true);
  });
});

describe("column alignment — a count or a measurement is end-aligned, everything else stays default", () => {
  /** [set, the keys on it that must be `align: "end"`] — every other key on
   *  the set must NOT be. Covers all 23 typed sets, not just the workloads.
   *  Typed on just `key`/`align`: the sets differ in row type, and alignment
   *  is the only thing this test needs to see. */
  const CASES: [{ key: string; align?: "start" | "end" }[], string[]][] = [
    [podColumns, ["ready", "restarts", "cpu", "memory", "age"]],
    [deploymentColumns, ["ready", "upToDate", "available", "age"]],
    [statefulSetColumns, ["ready", "updated", "age"]],
    [daemonSetColumns, ["desired", "current", "ready", "upToDate", "available", "age"]],
    [jobColumns, ["completions", "duration", "age"]],
    [cronJobColumns, ["active", "age"]],
    [nodeColumns, ["cpu", "memory", "age"]],
    [configMapColumns, ["keys", "age"]],
    [secretColumns, ["keys", "age"]],
    [resourceQuotaColumns, ["resources", "age"]],
    [limitRangeColumns, ["limits", "age"]],
    [serviceColumns, ["age"]],
    [ingressColumns, ["age"]],
    [endpointSliceColumns, ["endpoints", "age"]],
    [networkPolicyColumns, ["ingress", "egress", "age"]],
    [pvcColumns, ["capacity", "age"]],
    [pvColumns, ["capacity", "age"]],
    [storageClassColumns, ["age"]],
    [serviceAccountColumns, ["secrets", "age"]],
    [roleColumns, ["rules", "age"]],
    [clusterRoleColumns, ["rules", "age"]],
    [roleBindingColumns, ["subjects", "age"]],
    [clusterRoleBindingColumns, ["subjects", "age"]],
  ];

  it("end-aligns exactly the count and measurement columns on every typed set", () => {
    for (const [set, endKeys] of CASES) {
      for (const column of set) {
        const expected = endKeys.includes(column.key) ? "end" : undefined;
        expect(
          column.align,
          `${column.key} on a set of [${set.map((c) => c.key).join(", ")}]`,
        ).toBe(expected);
      }
    }
  });

  it("never right-aligns identity, status or descriptive text — name, status, type, image and the like", () => {
    expect(podColumns.find((c) => c.key === "name")!.align).toBeUndefined();
    expect(podColumns.find((c) => c.key === "phase")!.align).toBeUndefined();
    expect(podColumns.find((c) => c.key === "node")!.align).toBeUndefined();
    expect(secretColumns.find((c) => c.key === "type")!.align).toBeUndefined();
  });
});
