import { describe, it, expect } from "vitest";
import { summarizeAffinity, updateStrategyText, relatedPodSelector } from "./k8sWorkload";
import type { K8sObject } from "./manifest";

// Moved verbatim from apps/desktop/src/components/ResourceOverview.test.tsx
// (only the import path changed).
describe("summarizeAffinity", () => {
  it("summarizes required and preferred rules per affinity type", () => {
    const affinity = {
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{}, {}] },
        preferredDuringSchedulingIgnoredDuringExecution: [{}],
      },
      podAntiAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: [{}],
      },
    };
    expect(summarizeAffinity(affinity)).toEqual([
      "Node affinity: 2 required, 1 preferred",
      "Pod anti-affinity: 1 required",
    ]);
  });

  it("returns an empty list when there is no affinity", () => {
    expect(summarizeAffinity({})).toEqual([]);
  });
});

// classic's ResourceOverview.test.tsx did not cover updateStrategyText; written
// here against the body as moved (see k8sWorkload.ts), not against its name.
describe("updateStrategyText", () => {
  it("defaults to RollingUpdate with no parenthetical when the strategy is empty", () => {
    expect(updateStrategyText({})).toBe("RollingUpdate");
  });

  it("uses an explicit type when given, rather than always defaulting", () => {
    expect(updateStrategyText({ type: "OnDelete" })).toBe("OnDelete");
  });

  it("appends a partition clause when rollingUpdate.partition is set", () => {
    expect(updateStrategyText({ rollingUpdate: { partition: 2 } })).toBe(
      "RollingUpdate (partition 2)",
    );
  });

  it("appends a max-unavailable clause when rollingUpdate.maxUnavailable is set", () => {
    expect(updateStrategyText({ rollingUpdate: { maxUnavailable: 1 } })).toBe(
      "RollingUpdate (max unavailable 1)",
    );
  });

  it("appends a max-surge clause when rollingUpdate.maxSurge is set", () => {
    expect(updateStrategyText({ rollingUpdate: { maxSurge: "25%" } })).toBe(
      "RollingUpdate (max surge 25%)",
    );
  });

  it("joins multiple rollingUpdate clauses with a comma, in partition/maxUnavailable/maxSurge order", () => {
    expect(
      updateStrategyText({
        rollingUpdate: { partition: 1, maxUnavailable: 1, maxSurge: 1 },
      }),
    ).toBe("RollingUpdate (partition 1, max unavailable 1, max surge 1)");
  });
});

// classic's ResourceOverview.test.tsx did not cover relatedPodSelector either;
// written here against its actual per-kind branches.
describe("relatedPodSelector", () => {
  it("reads a Service's selector directly, with no matchLabels indirection", () => {
    const svc = { spec: { selector: { app: "web" } } } as K8sObject;
    expect(relatedPodSelector("Service", svc)).toEqual({ app: "web" });
  });

  it("reads a DaemonSet's selector through matchLabels, unlike Service", () => {
    const ds = { spec: { selector: { matchLabels: { app: "logging" } } } } as K8sObject;
    expect(relatedPodSelector("DaemonSet", ds)).toEqual({ app: "logging" });
    // Proves the matchLabels indirection is actually used (not the bare
    // selector, as Service uses): a selector with no matchLabels field
    // yields nothing.
    const bare = { spec: { selector: { app: "logging" } } } as K8sObject;
    expect(relatedPodSelector("DaemonSet", bare)).toEqual({});
  });

  it("reads a Job's selector through matchLabels, same as DaemonSet", () => {
    const job = { spec: { selector: { matchLabels: { "job-name": "backup" } } } } as K8sObject;
    expect(relatedPodSelector("Job", job)).toEqual({ "job-name": "backup" });
  });

  it("reads a PodDisruptionBudget's selector through matchLabels, as its own switch case", () => {
    const pdb = { spec: { selector: { matchLabels: { app: "pdb" } } } } as K8sObject;
    expect(relatedPodSelector("PodDisruptionBudget", pdb)).toEqual({ app: "pdb" });
  });

  it("reads a NetworkPolicy's podSelector, not its selector", () => {
    const np = {
      spec: {
        selector: { matchLabels: { app: "wrong" } },
        podSelector: { matchLabels: { app: "netpol" } },
      },
    } as K8sObject;
    expect(relatedPodSelector("NetworkPolicy", np)).toEqual({ app: "netpol" });
  });

  it("returns an empty object for a kind with no related-pod selector", () => {
    const deploy = { spec: { selector: { matchLabels: { app: "deploy" } } } } as K8sObject;
    expect(relatedPodSelector("Deployment", deploy)).toEqual({});
  });
});
