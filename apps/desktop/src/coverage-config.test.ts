// @vitest-environment node
// (importing vitest/config pulls in esbuild, which refuses to run under the
// jsdom environment the rest of the suite uses — node is fine)
import { describe, expect, it } from "vitest";
// The gate moved to the workspace root when @srelens/core was extracted:
// each package alone sits below floors calibrated for the combined codebase,
// so the two are measured together. This canary follows it there.
import config from "../../../vitest.config";

// Canary for issue #29: vitest 1.x silently ignored thresholds placed at the
// top level of `coverage` — they only bite under `coverage.thresholds`. This
// asserts on the exported config object itself, so a floor that is commented
// out, moved under `test`, or otherwise outside `test.coverage.thresholds`
// fails here instead of silently turning the coverage gate off.
//
// It also catches the gate being dropped entirely while both packages still
// report green, which is what would happen if the root config lost its
// coverage block.
describe("coverage threshold config", () => {
  type CoverageShape = {
    lines?: number;
    branches?: number;
    functions?: number;
    thresholds?: { lines?: number; branches?: number; functions?: number };
  };
  const coverage = (config as { test?: { coverage?: CoverageShape } }).test?.coverage;

  it("keeps the enforced floors in the shape vitest actually reads", () => {
    expect(coverage?.thresholds?.lines).toBeGreaterThanOrEqual(85);
    expect(coverage?.thresholds?.branches).toBeGreaterThanOrEqual(80);
    expect(coverage?.thresholds?.functions).toBeGreaterThanOrEqual(76);
  });

  it("has no floors in the silently-ignored top-level spot", () => {
    expect(coverage?.lines).toBeUndefined();
    expect(coverage?.branches).toBeUndefined();
    expect(coverage?.functions).toBeUndefined();
  });

  it("measures both packages, not just the app", () => {
    // Measuring one package alone would report a floor that no longer covers
    // most of the frontend.
    const projects = (config as { test?: { projects?: string[] } }).test?.projects;
    expect(projects).toContain("apps/desktop");
    expect(projects).toContain("packages/core");
  });
});
