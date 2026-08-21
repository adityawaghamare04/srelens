// @vitest-environment node
import { describe as suite, it, expect } from "vitest";
import { describe, isBuiltInKind, screenFor } from "./routes";
import { AppLog } from "../screens/AppLog";
import { ReleaseNotes } from "../screens/ReleaseNotes";

suite("isBuiltInKind", () => {
  it("recognises a built-in list kind by its slug", () => {
    expect(isBuiltInKind("pods")).toBe(true);
    expect(isBuiltInKind("deployments")).toBe(true);
  });

  it("does not count overview, which is a kind in core but not a list", () => {
    // `K8S_KIND.overview` is "" — it has no Kubernetes kind behind it, and its
    // route is /overview, not /k/overview.
    expect(isBuiltInKind("overview")).toBe(false);
  });

  it("treats anything else as a custom resource slug", () => {
    expect(isBuiltInKind("certificates.cert-manager.io")).toBe(false);
  });
});

suite("describe", () => {
  it("names the home route and pins it", () => {
    const info = describe("/", "prod-eu");
    expect(info).toMatchObject({ route: "/", title: "Control room", kind: "control", pinned: true });
  });

  it("uses the real cluster name as the sub for cluster-scoped routes", () => {
    // Not the mock's hard-coded "prod-eu".
    expect(describe("/k/pods", "staging-1").sub).toBe("staging-1");
    expect(describe("/logs", "staging-1").sub).toBe("staging-1");
  });

  it("gives app-scoped routes no sub at all", () => {
    for (const route of ["/applog", "/notes", "/settings", "/connections", "/connect", "/toolbox"]) {
      expect(describe(route, "staging-1").sub, route).toBeUndefined();
    }
  });

  it("titles a built-in kind from core's labels", () => {
    expect(describe("/k/pods", "c").title).toBe("Pods");
    expect(describe("/k/pods", "c").kind).toBe("workloads");
  });

  it("titles a custom resource from its slug, as a resource", () => {
    const info = describe("/k/certificates.cert-manager.io", "c");
    expect(info.title).toBe("certificates.cert-manager.io");
    expect(info.kind).toBe("workloads");
  });

  it("names a resource detail after the resource", () => {
    expect(describe("/resources/web-1", "c")).toMatchObject({ title: "web-1", kind: "resource", sub: "c" });
  });

  it("names an edit tab after what it edits", () => {
    expect(describe("/edit/web-1", "c")).toMatchObject({ title: "Edit web-1", kind: "edit" });
  });

  it("falls back to the path for a route it has never heard of", () => {
    expect(describe("/whatever", "c")).toMatchObject({ title: "whatever", kind: "control" });
  });

  it("still describes a cluster-scoped route when there is no cluster yet", () => {
    // First launch with no contexts: the tab must still have a title.
    expect(describe("/k/pods").title).toBe("Pods");
    expect(describe("/k/pods").sub).toBeUndefined();
  });
});

suite("screenFor", () => {
  it("resolves the screens that have been ported", () => {
    expect(screenFor("/applog")).toBe(AppLog);
    expect(screenFor("/notes")).toBe(ReleaseNotes);
  });

  it("gives a route with no screen a placeholder", () => {
    for (const route of ["/", "/k/pods", "/settings"]) {
      expect(screenFor(route), route).toBeNull();
    }
  });

  it("does not hand out Object.prototype members as screens", () => {
    // A route is a string from a tab, which can come from a persisted session
    // or a resource name. `SCREENS["constructor"]` on a plain object literal is
    // a function, so `Body` would have rendered `Object` as a component.
    for (const route of ["constructor", "/constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(screenFor(route), route).toBeNull();
    }
  });
});

suite("describe against inherited keys", () => {
  it("falls through to the default title rather than a prototype member", () => {
    // Same hole as `screenFor`: `APP_SCOPED["constructor"]` on a plain object
    // literal is truthy, and spreading a function produced a title-less tab.
    expect(describe("constructor", "c")).toMatchObject({ title: "constructor", kind: "control" });
    expect(describe("/constructor", "c")).toMatchObject({ title: "constructor", kind: "control" });
    expect(describe("toString", "c").title).toBe("toString");
  });
});
