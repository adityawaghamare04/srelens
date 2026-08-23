import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FactGrid } from "./FactGrid";
import { KV } from "./KV";
import { Section } from "./Section";

describe("FactGrid", () => {
  it("wraps the body it is given rather than replacing it", () => {
    const { container, getByText } = render(
      <FactGrid>
        <Section>
          <KV k="Status" v="Running" />
        </Section>
      </FactGrid>,
    );
    // The rows are the caller's, untouched: the grid restyles a body it did
    // not build, which is the whole point — one derivation, two layouts.
    expect(container.querySelector(".factgrid .section .kv")).toBeTruthy();
    expect(getByText("Status")).toBeDefined();
    expect(getByText("Running")).toBeDefined();
  });

  it("carries the column count as a custom property, not a class per count", () => {
    // A class per count is a class the stylesheet has to enumerate, and the
    // one nobody added is the one a caller asks for.
    const { container } = render(
      <FactGrid columns={2}>
        <Section>
          <KV k="Status" v="Running" />
        </Section>
      </FactGrid>,
    );
    const root = container.querySelector<HTMLElement>(".factgrid")!;
    expect(root.style.getPropertyValue("--fact-cols")).toBe("2");
  });

  it("defaults to the three columns the design draws", () => {
    const { container } = render(
      <FactGrid>
        <Section>
          <KV k="Status" v="Running" />
        </Section>
      </FactGrid>,
    );
    expect(container.querySelector<HTMLElement>(".factgrid")!.style.getPropertyValue("--fact-cols")).toBe("3");
  });
});

/**
 * The layout is CSS over a body the grid does not own, so what it actually
 * does is unobservable in jsdom — no layout is computed. The rules are read
 * off the stylesheet instead, which is the same thing `Tabs.test` does for the
 * strip's minimum width.
 */
describe("the fact grid's rules", () => {
  const css = readFileSync(join(__dirname, "styles/kit.css"), "utf8");
  const components = css.slice(css.indexOf("@layer components {"), css.indexOf("@layer utilities {"));

  it("lays a section's fact rows out in as many columns as it was asked for", () => {
    const rule = components.slice(components.indexOf("  .factgrid .section {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("display: grid");
    expect(body).toContain("var(--fact-cols)");
  });

  it("stacks the label over the value, which the peek's row does not", () => {
    const rule = components.slice(components.indexOf("  .factgrid .kv {"));
    const body = rule.slice(0, rule.indexOf("}"));
    // `.kv` is a two-column grid everywhere else; here it is one block with
    // the term above the value, and a hairline under the pair.
    expect(body).toContain("display: block");
    expect(body).toContain("border-bottom");
  });

  it("gives anything that is not a fact row the whole width", () => {
    // A section holds more than rows — a heading, a table of volumes, a
    // pods list. Dropped into a three-column grid each of those becomes one
    // narrow cell, which is not a layout, it is a bug.
    expect(components).toContain(".factgrid .section > :not(.kv) { grid-column: 1 / -1; }");
  });

  it("places a table itself, since its wrapper is display: contents", () => {
    // `Table` renders `<div style="display: contents"><table>`, so the div is
    // never a grid item and a `grid-column` on it does nothing at all. The
    // rule above would silently miss every table in a detail body.
    expect(components).toContain(".factgrid .section table { grid-column: 1 / -1; }");
  });

  it("leaves the peek's own rows alone", () => {
    // The rule is scoped under `.factgrid` throughout: the peek renders the
    // very same `KV`s and must not change.
    const factRules = components.match(/^\s*\.factgrid[^\n]*\{/gm) ?? [];
    expect(factRules.length).toBeGreaterThan(0);
    expect(factRules.every((r) => r.trim().startsWith(".factgrid"))).toBe(true);
  });
});
