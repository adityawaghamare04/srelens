import { describe, it, expect } from "vitest";
import { WATCHABLE_KINDS, type ResourceKind } from "@srelens/core";
import { NAV_GROUPS } from "../tree";
import { descriptorFor, CLUSTER_SCOPED } from "./descriptors";

/** Every kind the sidebar offers, minus Events, which routes to its own screen. */
const SIDEBAR_KINDS = NAV_GROUPS.flatMap((g) => g.kinds).filter((k) => k !== "events");

describe("descriptors", () => {
  it("answers for every kind the sidebar can reach", () => {
    const missing = SIDEBAR_KINDS.filter((k) => !descriptorFor(k));
    expect(missing).toEqual([]);
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
