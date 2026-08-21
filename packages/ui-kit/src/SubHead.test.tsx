import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubHead } from "./SubHead";

/** New: the mock shipped this component with no tests at all. (#320) */
describe("SubHead", () => {
  it("renders its content", () => {
    render(<SubHead>Containers</SubHead>);
    expect(screen.getByText("Containers")).toBeDefined();
  });

  it("is a heading, not a bold div", () => {
    // Every call site in the design labels a group inside a panel — Labels,
    // Annotations, Conditions, Containers. A styled div drops all of them out
    // of the document outline, which is the finding Panel's h2 came from.
    render(<SubHead>Annotations</SubHead>);
    expect(screen.getByRole("heading", { level: 3, name: "Annotations" })).toBeDefined();
  });

  it("keeps the design's size and weight", () => {
    // Preflight resets a heading's font-size and weight to inherit, so the
    // utilities are what makes an h3 look like this subheading rather than a
    // browser heading.
    const { container } = render(<SubHead>Clients</SubHead>);
    const head = container.querySelector("h3");
    expect(head?.className).toContain("font-semibold");
    expect(head?.className).toContain("text-[0.75rem]");
  });

  it("forwards className", () => {
    const { container } = render(<SubHead className="mb-1">Labels</SubHead>);
    expect(container.querySelector("h3.mb-1")).not.toBeNull();
  });
});
