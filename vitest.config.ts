import { defineConfig } from "vitest/config";

/**
 * One coverage gate for the whole frontend.
 *
 * The 85/80/76 floors were calibrated when every frontend module lived in
 * apps/desktop. Extracting @srelens/core split that codebase in two without
 * changing a line of it or a single test, and each half alone sits below a
 * floor set for the whole — the service layer because much of it is exercised
 * through component tests, the app because its most-tested modules left.
 *
 * Measuring the two together keeps the gate meaning exactly what it meant
 * before, rather than lowering two numbers to match an accident of packaging.
 */
export default defineConfig({
  test: {
    projects: ["apps/desktop", "packages/core"],
    coverage: {
      provider: "v8",
      // Never lower any of these.
      thresholds: { lines: 85, branches: 80, functions: 76 },
      include: ["apps/desktop/src/**/*.{ts,tsx}", "packages/core/src/**/*.ts"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "apps/desktop/src/main.tsx",
        "apps/desktop/src/test-setup.ts",
        // xterm DOM integration — verified live, not unit-testable in jsdom.
        "apps/desktop/src/components/PodTerminal.tsx",
        "packages/core/src/index.ts",
        "packages/core/src/react.ts",
      ],
    },
  },
});
