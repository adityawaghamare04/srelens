import { describe, it, expect } from "vitest";
import { WATCHABLE_KINDS, type ResourceKind } from "@srelens/core";
import { NAV_GROUPS } from "../tree";
import { descriptorFor, CLUSTER_SCOPED } from "./descriptors";

/** Every kind the sidebar offers, minus Events, which routes to its own screen. */
const SIDEBAR_KINDS = NAV_GROUPS.flatMap((g) => g.kinds).filter((k) => k !== "events");

describe("descriptors", () => {
  // This asserts coverage only: no sidebar route resolves to `undefined`. It
  // cannot catch a kind that *should* have typed columns shipping the generic
  // three instead — `NAV_GROUPS.kinds` is typed `ResourceKind[]`, `tree.ts`
  // already routes the three screen-kinds elsewhere, and `descriptorFor` falls
  // back to the generic descriptor for anything absent from `TYPED`, so every
  // element of `SIDEBAR_KINDS` resolves by construction. That guard belongs at
  // the end of Task 5, once `TYPED` is populated and "resolves" and "resolves
  // to something typed" are different claims.
  it("resolves every kind the sidebar can reach, rather than leaving a route with no descriptor", () => {
    const missing = SIDEBAR_KINDS.filter((k) => !descriptorFor(k));
    expect(missing).toEqual([]);
  });

  // Genuine fallback coverage at this stage, before any kind is typed: `leases`
  // and `runtimeclasses` are outside `WATCHABLE_KINDS` and are not `nodes` —
  // the only kinds Tasks 4-5 (which only add entries for watchable kinds, plus
  // `nodes` as the one named exception) will ever move out of the generic set.
  it("gives a namespaced kind with no typed entry the generic columns", () => {
    expect(descriptorFor("leases")!.columns.map((c) => c.key)).toEqual(["name", "namespace", "age"]);
  });

  it("gives a cluster-scoped kind with no typed entry the generic columns, minus namespace", () => {
    expect(descriptorFor("runtimeclasses")!.columns.map((c) => c.key)).toEqual(["name", "age"]);
  });

  it("streams exactly the kinds the backend can watch, and polls the rest", () => {
    for (const kind of SIDEBAR_KINDS) {
      const watchable = (WATCHABLE_KINDS as readonly string[]).includes(kind);
      expect(descriptorFor(kind)!.source).toBe(watchable ? "watch" : "poll");
    }
  });

  it("names the identifier column first, for every kind", () => {
    for (const kind of SIDEBAR_KINDS) {
      expect(descriptorFor(kind)!.columns[0].key).toBe("name");
    }
  });

  it("marks the cluster-scoped kinds, and only those", () => {
    for (const kind of SIDEBAR_KINDS) {
      const expected = (CLUSTER_SCOPED as readonly string[]).includes(kind) ? "cluster" : "namespaced";
      expect(descriptorFor(kind)!.scope).toBe(expected);
    }
  });

  it("has no namespace column on a cluster-scoped kind, which would always be blank", () => {
    for (const kind of CLUSTER_SCOPED) {
      const d = descriptorFor(kind);
      if (!d) continue;
      expect(d.columns.some((c) => c.key === "namespace")).toBe(false);
    }
  });

  it("does not answer for a slug that is not a kind", () => {
    expect(descriptorFor("overview")).toBeUndefined();
    expect(descriptorFor("widgets.example.com")).toBeUndefined();
    expect(descriptorFor("constructor")).toBeUndefined();
  });
});
