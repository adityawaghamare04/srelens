import { describe, it, expect, beforeEach } from "vitest";
import type { ClusterContext } from "@srelens/core";
import { contextFor, getContexts, resetContexts, setContexts } from "./clusters";

const ctx = (stableId: string, name = stableId): ClusterContext => ({
  name, stableId, cluster: name, server: "", isCurrent: false,
});

describe("contexts store", () => {
  beforeEach(resetContexts);

  it("resolves a stableId to the context whose name core's calls take", () => {
    setContexts([ctx("prod-1", "prod"), ctx("dev-1", "dev")]);
    expect(contextFor("prod-1")?.name).toBe("prod");
  });

  it("answers undefined for a cluster the kubeconfig no longer declares", () => {
    setContexts([ctx("prod-1", "prod")]);
    expect(contextFor("gone")).toBeUndefined();
    expect(contextFor(null)).toBeUndefined();
  });

  it("hands back the same array until it is replaced, so a subscriber cannot tear", () => {
    setContexts([ctx("prod-1")]);
    expect(getContexts()).toBe(getContexts());
  });
});
