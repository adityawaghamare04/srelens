import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      lines: 85,
      thresholdAutoUpdate: false,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/main.tsx",
        "src/test-setup.ts",
        // xterm DOM integration — verified live, not unit-testable in jsdom.
        "src/components/PodTerminal.tsx",
      ],
    },
  },
});
