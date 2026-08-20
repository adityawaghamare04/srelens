import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * No component may name a colour of its own.
 *
 * Every value comes from a token, or the component stops following the theme
 * the moment someone switches to dark — and that failure is invisible in a
 * gallery viewed in one mode. The mock carried thirteen raw hex values for
 * exactly this reason, and they do not come across.
 *
 * Kit-wide rather than per-component: the rule is about the design system, and
 * a rule asserted in one file is a rule the next file forgets.
 */
const HEX = /#[0-9a-fA-F]{3,8}\b/;

describe("the design system", () => {
  const sources = readdirSync(__dirname).filter(
    (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."),
  );

  it("has components to check", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("names no colour outside the tokens", () => {
    const offenders = sources.filter((f) => {
      const source = readFileSync(join(__dirname, f), "utf8");
      // Strip comments: the rule is discussed in prose in several places.
      return HEX.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ""));
    });
    expect(offenders, `raw colour values in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("does not depend on the service layer", () => {
    // A design system that knows about capabilities is not reusable, and the
    // boundary is far easier to keep than to recover.
    const offenders = sources.filter((f) =>
      /@srelens\/core/.test(readFileSync(join(__dirname, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
