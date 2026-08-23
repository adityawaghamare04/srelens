import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { CrdRef } from "@srelens/core";
import { AboutKind } from "./AboutKind";

const WIDGETS: CrdRef = {
  name: "widgets.example.com",
  group: "example.com",
  version: "v1",
  kind: "Widget",
  plural: "widgets",
  namespaced: true,
  versions: ["v1", "v1beta1"],
  storageVersion: "v1",
};

function about(crd: CrdRef, objects = 3) {
  const { container } = render(<AboutKind crd={crd} context="prod-eu" objects={objects} />);
  return container;
}

/** Every key/value pair the rail drew, in the order it drew them. */
const definition = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("dl.kv")).map(
    (kv) =>
      [kv.querySelector(".kv-k")?.textContent ?? "", kv.querySelector(".kv-v")?.textContent ?? ""] as const,
  );

const keys = (container: HTMLElement) => definition(container).map(([k]) => k);

const valueOf = (container: HTMLElement, key: string) =>
  definition(container).find(([k]) => k === key)?.[1];

describe("AboutKind", () => {
  it("reads a kind's definition off the CRD, in the design's own order", () => {
    const container = about(WIDGETS, 12);

    expect(keys(container)).toEqual(["Kind", "Scope", "Served versions", "Storage version", "Objects"]);
    expect(definition(container)).toEqual([
      ["Kind", "Widget"],
      ["Scope", "Namespaced"],
      ["Served versions", "v1, v1beta1"],
      ["Storage version", "v1"],
      ["Objects", "12"],
    ]);
  });

  it("says Cluster for a cluster-scoped CRD, which the design never draws", () => {
    // The design hard-codes `Namespaced` and never renders a ClusterIssuer or a
    // PriorityClass, though its own tree lists both. The CRD knows.
    expect(valueOf(about({ ...WIDGETS, namespaced: false }), "Scope")).toBe("Cluster");
  });

  it("omits a version row it has nothing to put in, rather than drawing it blank", () => {
    // Both fields are optional on `CrdRef` — an older backend and a hand-built
    // ref in a test alike arrive without them.
    const container = about({ ...WIDGETS, versions: undefined, storageVersion: undefined });

    expect(keys(container)).toEqual(["Kind", "Scope", "Objects"]);
    expect(container.textContent).not.toContain("Served versions");
    expect(container.textContent).not.toContain("Storage version");
  });

  it("keeps the served versions when only the storage version is missing", () => {
    const container = about({ ...WIDGETS, storageVersion: undefined });

    expect(keys(container)).toEqual(["Kind", "Scope", "Served versions", "Objects"]);
  });

  it("drops a served-versions row for a CRD that serves an empty list", () => {
    expect(keys(about({ ...WIDGETS, versions: [] }))).toEqual(["Kind", "Scope", "Storage version", "Objects"]);
  });

  it("names the real kind, not the slug with its first letter upper-cased", () => {
    // The design titles `servicemonitors` as `Servicemonitors`. The CRD says
    // `ServiceMonitor`, and that is the kind anyone types at kubectl.
    const container = about({
      ...WIDGETS,
      name: "servicemonitors.monitoring.coreos.com",
      kind: "ServiceMonitor",
      plural: "servicemonitors",
    });

    expect(valueOf(container, "Kind")).toBe("ServiceMonitor");
    expect(container.textContent).not.toContain("Servicemonitors");
  });

  it("hands the reader the command for this cluster and this CRD", () => {
    const container = about({
      ...WIDGETS,
      name: "servicemonitors.monitoring.coreos.com",
      kind: "ServiceMonitor",
    });

    expect(container.querySelector("code.code")?.textContent).toBe(
      "kubectl --context prod-eu get servicemonitors.monitoring.coreos.com -A -o wide",
    );
  });

  it("renders its sections as siblings, so the rail rules between them", () => {
    // `SideRail` drops its `rail` straight into one box and `.section +
    // .section` is what draws the hairline. A wrapper of our own around either
    // block breaks that adjacency and the rail reads as one undivided slab.
    const container = about(WIDGETS);
    const kids = Array.from(container.children);

    expect(kids.map((el) => el.tagName)).toEqual(["SECTION", "SECTION"]);
    expect(kids.map((el) => el.querySelector(".section-title")?.textContent)).toEqual([
      "Definition",
      "Fetch it yourself",
    ]);
  });
});
