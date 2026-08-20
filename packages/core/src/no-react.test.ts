import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `@srelens/core` is consumed by more than one UI, so a React import in the
 * main entry point is the package boundary failing. Asserted rather than left
 * to review: this is the kind of rule that erodes one convenient import at a
 * time.
 *
 * The two hooks that legitimately use React live behind the "./react" entry
 * and are exempt.
 */
const EXEMPT = new Set(["access.ts", "useNamespaceOptions.ts"]);

function sourcesIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

describe("the service layer", () => {
  it("does not import React outside the ./react entry point", () => {
    const dir = join(__dirname, "lib");
    const offenders = sourcesIn(dir)
      .filter((f) => !EXEMPT.has(f))
      .filter((f) => /from ["']react["']/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("does not import React in the transport layer", () => {
    const dir = join(__dirname, "transport");
    const offenders = sourcesIn(dir).filter((f) =>
      /from ["']react["']/.test(readFileSync(join(dir, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the two React hooks out of the main barrel", () => {
    // Re-exporting them from index.ts would pull React into every consumer of
    // the main entry, which is the same failure by a different route.
    const barrel = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(barrel).not.toMatch(/lib\/access/);
    expect(barrel).not.toMatch(/lib\/useNamespaceOptions/);
  });
});
