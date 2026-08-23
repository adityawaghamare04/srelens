import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Section } from "./Section";

/**
 * New with the detail pane's design mock: a run of sections divided by
 * hairline rules, which `Panel` cannot draw because it is a card. (#331)
 */
describe("Section", () => {
  it("names the block with a heading", () => {
    // The outline is how a screen reader finds Conditions, Labels and
    // Annotations inside the peek; a styled div drops all three out of it.
    render(<Section title="Conditions">rows</Section>);
    expect(screen.getByRole("heading", { level: 3, name: "Conditions" })).toBeDefined();
  });

  it("renders its content", () => {
    render(<Section title="Labels">app=web</Section>);
    expect(screen.getByText("app=web")).toBeDefined();
  });

  it("takes no heading at all when the caller has none", () => {
    // The mock puts no heading over the first fact list, and an empty heading
    // line is a visible gap rather than a no-op.
    const { container } = render(<Section>rows</Section>);
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.getByText("rows")).toBeDefined();
  });

  it("is flat, not a card", () => {
    // The whole reason it exists beside Panel: no border, no lifted surface.
    const { container } = render(<Section title="Labels">rows</Section>);
    const root = container.querySelector("section");
    expect(root?.className).toContain("section");
    expect(root?.className).not.toContain("card");
  });

  it("forwards className onto the section", () => {
    const { container } = render(
      <Section title="Labels" className="extra">
        rows
      </Section>,
    );
    expect(container.querySelector("section.section.extra")).not.toBeNull();
  });
});

describe("a run of sections", () => {
  const css = readFileSync(join(__dirname, "styles", "kit.css"), "utf8");
  const components = css.slice(css.indexOf("@layer components {"), css.indexOf("@layer utilities {"));

  it("rules between siblings and not around them, in the components layer", () => {
    // A rule per section would draw one above the first and below the last;
    // the mock divides, it does not box. Asserted on the stylesheet because
    // jsdom does no layout. The components layer matters: a utility applied in
    // the JSX has to be able to override this, and Tailwind's utilities layer
    // is declared after it.
    expect(components).toContain(".section + .section { border-top: 1px solid var(--rule); }");
    const rule = components.slice(components.indexOf("\n  .section {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toContain("border:");
    expect(body).not.toContain("background:");
  });
});
