import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Condition } from "@srelens/core";
import { AnnotationLines, ConditionsSection, partitionAnnotations } from "./ConditionsSection";

const DEPLOYMENT_CONDITIONS: Condition[] = [
  { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" },
  { type: "Progressing", status: "True", reason: "ReplicaSetUpdated" },
  { type: "ReplicaFailure", status: "False" },
];

/** The colour `StatusPill` painted a condition's name with, empty when it
 *  left the name plain. Read off the inline style the component documents as
 *  its own mechanism rather than off a `data-*` attribute, which is the kit's
 *  to add or drop. */
function tone(container: HTMLElement, name: string): string {
  const pill = [...container.querySelectorAll(".status")].find((el) => el.textContent === name);
  return (pill as HTMLElement | undefined)?.style.color ?? "no such condition";
}

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
    // The design's asymmetric rule: red `Available`, plain `ReplicaFailure`
    // beside its own ok dot. `StatusPill` owns which kinds count as bad and
    // paints the word with an inline tone; this asserts the flag reached it,
    // not a colour computed here. `Progressing` is the third case and is
    // pinned with the whole row below.
    const { container } = render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    expect(tone(container, "Available")).toBe("var(--sev)");
    expect(tone(container, "ReplicaFailure")).toBe("");
  });

  it("draws the design frame's three-tone Conditions row entire: danger, warning, ok", () => {
    // THE pin for frame A of the user's mock, asserted as one thing because
    // it is one thing: three conditions of a mid-rollout Deployment, each
    // with its own dot tone AND its own name colour, in the frame's order.
    //
    //   (danger)  Available       False · MinimumReplicasUnavailable   red name
    //   (warn)    Progressing     True  · ReplicaSetUpdated            amber name
    //   (ok)      ReplicaFailure  False · —                            plain name
    //
    // Every tone is core's `conditionKind`; this section keeps no second
    // heuristic, which is why two core bugs the frame exposed could be fixed
    // where the list column and every other reader of a condition's tone got
    // them too. `Failed` did not match `ReplicaFailure`, so a Deployment's
    // healthy state read as a failure; and a `Progressing` condition was
    // toned on its status alone, so a rollout still in flight was drawn the
    // same green as one that had landed — the mock's own two frames prove
    // the difference, tone by reason, with the same type and status in both.
    //
    // The name colour is the asymmetric half of the rule: a bad state is
    // worth the ink, a good one is not, so the ok row alone reads plain.
    const { container } = render(<ConditionsSection conditions={DEPLOYMENT_CONDITIONS} />);
    const kinds = [...container.querySelectorAll(".status")].map((el) => el.getAttribute("data-kind"));
    expect(kinds).toEqual(["danger", "warning", "success"]);
    expect([
      tone(container, "Available"),
      tone(container, "Progressing"),
      tone(container, "ReplicaFailure"),
    ]).toEqual(["var(--sev)", "var(--warn)", ""]);
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

describe("AnnotationLines", () => {
  const APPLIED = "kubectl.kubernetes.io/last-applied-configuration";
  const MANIFEST = `{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"checkout-api"},"spec":{"replicas":12}}`;

  it("prints every annotation as a full-width key=value line", () => {
    render(<AnnotationLines annotations={{ "checksum/config": "8f41c2a9", "srelens.io/last-applied-by": "dana@acme.io" }} />);
    expect(screen.getByText("checksum/config=")).toBeDefined();
    expect(screen.getByText("8f41c2a9")).toBeDefined();
    expect(screen.getByText("dana@acme.io")).toBeDefined();
  });

  it("wraps long values instead of truncating them, since nothing else can read them now", () => {
    // `PairList` no longer writes the value into a `title`, so a truncated
    // row is a value nobody can read at all.
    const { container } = render(<AnnotationLines annotations={{ note: "a".repeat(400) }} />);
    expect(container.querySelector("li.truncate")).toBeNull();
    expect(container.querySelector(".v.break-all")).not.toBeNull();
  });

  it("withholds the applied-manifest annotation and says where to read it", () => {
    render(<AnnotationLines annotations={{ [APPLIED]: MANIFEST, "checksum/config": "8f41c2a9" }} />);
    expect(screen.queryByText(MANIFEST)).toBeNull();
    expect(screen.queryByText(`${APPLIED}=`)).toBeNull();
    const note = screen.getByText(new RegExp(APPLIED));
    expect(note.textContent).toMatch(/YAML/);
    // The other annotations are untouched.
    expect(screen.getByText("8f41c2a9")).toBeDefined();
  });

  it("keeps the withheld value out of the document entirely, not merely out of sight", () => {
    const { container } = render(<AnnotationLines annotations={{ [APPLIED]: MANIFEST }} />);
    expect(container.innerHTML).not.toContain("replicas");
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("says nothing about withholding when there is nothing to withhold", () => {
    render(<AnnotationLines annotations={{ "checksum/config": "8f41c2a9" }} />);
    expect(screen.queryByText(/not printed/)).toBeNull();
  });

  it("renders nothing at all for an object with no annotations", () => {
    const { container } = render(<AnnotationLines annotations={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("names what it withheld, so a caller can render its own note", () => {
    expect(partitionAnnotations({ [APPLIED]: MANIFEST, app: "web" })).toEqual({
      shown: [["app", "web"]],
      withheld: [APPLIED],
    });
    expect(partitionAnnotations({ app: "web" })).toEqual({ shown: [["app", "web"]], withheld: [] });
  });
});
