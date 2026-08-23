// @vitest-environment node
import { describe, it, expect } from "vitest";
import { detailRoute, parseDetailRoute } from "./detailRoute";

describe("detailRoute", () => {
  it("carries the kind, the namespace and the name", () => {
    expect(detailRoute("Pod", "kube-system", "web-0")).toBe("/k/Pod/kube-system/web-0");
  });

  it("stands a placeholder in for a cluster-scoped kind, so the arity never varies", () => {
    expect(detailRoute("Node", null, "worker-1")).toBe("/k/Node/-/worker-1");
  });

  it("encodes every segment, so a name cannot change the route's shape", () => {
    // A CRD's kind and a resource's name can both contain a slash in the wild.
    const route = detailRoute("Widget", "default", "a/b");
    expect(route.split("/")).toHaveLength(5);
    expect(parseDetailRoute(route)!.name).toBe("a/b");
  });

  it("round-trips", () => {
    for (const [k, ns, n] of [["Pod", "default", "web"], ["Node", null, "n1"]] as const) {
      expect(parseDetailRoute(detailRoute(k, ns, n))).toEqual({ kind: k, namespace: ns, name: n });
    }
  });

  it("refuses a route that is not a detail route", () => {
    expect(parseDetailRoute("/k/pods")).toBeNull(); // a LIST route
    expect(parseDetailRoute("/k/Pod/default")).toBeNull(); // too few segments
    expect(parseDetailRoute("/resources")).toBeNull();
  });
});
