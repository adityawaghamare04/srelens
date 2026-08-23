import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Condition } from "@srelens/core";
import { ConditionsSection } from "./ConditionsSection";

const DEPLOYMENT_CONDITIONS: Condition[] = [
  { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" },
  { type: "Progressing", status: "True", reason: "ReplicaSetUpdated" },
  { type: "ReplicaFailure", status: "False" },
];

describe("ConditionsSection", () => {
  it("names the block and gives every condition a row", () => {
    const { container } = render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    expect(screen.getByRole("heading", { level: 3, name: "Conditions" })).toBeDefined();
    expect(container.querySelectorAll(".kv")).toHaveLength(3);
  });

  it("reads the condition's name on the left and its status and reason on the right", () => {
    render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    expect(screen.getByText("Available")).toBeDefined();
    expect(screen.getByText("False · MinimumReplicasUnavailable")).toBeDefined();
    expect(screen.getByText("True · ReplicaSetUpdated")).toBeDefined();
  });

  it("stands an em dash in for a condition that reports no reason", () => {
    render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    expect(screen.getByText("False · —")).toBeDefined();
  });

  it("drops the last-transition column the design does not have", () => {
    render(
      <ConditionsSection
        conditions={[{ type: "Available", status: "True", lastTransitionTime: "2026-08-20T00:00:00Z" }]}
      />,
    );
    expect(screen.queryByText("Last transition")).toBeNull();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("colours the name of a bad condition and leaves a good one plain", () => {
    // The design's asymmetric rule: red `Available`, plain `Progressing`
    // beside its own ok dot. `StatusPill` owns which kinds count as bad, so
    // this asserts the flag reached it, not a colour computed here.
    const { container } = render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    const pills = [...container.querySelectorAll(".status")];
    const byName = new Map(pills.map((p) => [p.textContent, p]));
    expect(byName.get("Available")?.getAttribute("data-bad")).toBe("true");
    expect(byName.get("Progressing")?.getAttribute("data-bad")).toBeNull();
  });

  it("takes every tone from core's one heuristic, including where that heuristic is wrong", () => {
    // `ReplicaFailure: False` is a Deployment's healthy state, and the design
    // frame draws it ok-toned with an uncoloured name. core's `conditionKind`
    // matches /Failed/ but not /Failure/, so it reads the row as danger and
    // this section colours it. Pinned so the divergence is visible rather
    // than silent: the fix belongs in `conditionKind`, where the list column
    // and every other reader of a condition's tone would get it too, not in a
    // second heuristic kept here.
    const { container } = render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    const pills = [...container.querySelectorAll(".status")];
    const replicaFailure = pills.find((p) => p.textContent === "ReplicaFailure");
    expect(replicaFailure?.getAttribute("data-bad")).toBe("true");
  });

  it("says the state in words, never in colour alone", () => {
    render(<ConditionsSection conditions={[{ type: "Available", status: "False" }]} />);
    // "False" is in the row's own text, so the dot is a second channel.
    expect(screen.getByText(/False/)).toBeDefined();
  });

  it("renders nothing at all for an object that reports no conditions", () => {
    const { container } = render(<ConditionsSection conditions={[]} />);
    expect(container.querySelector("section")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("is a flat section, not a card", () => {
    const { container } = render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    expect(container.querySelector("section.section")).not.toBeNull();
    expect(container.querySelector(".card")).toBeNull();
  });

  it("takes conditions as data, so any kind's list renders the same way", () => {
    // A Pod's lifecycle conditions, which carry no reason at all — the module
    // must not reach for a workload's status or a Pod's phase to render them.
    render(
      <ConditionsSection
        conditions={[
          { type: "Initialized", status: "True" },
          { type: "Ready", status: "True" },
        ]}
      />,
    );
    expect(screen.getByText("Initialized")).toBeDefined();
    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.getAllByText("True · —")).toHaveLength(2);
  });
});
