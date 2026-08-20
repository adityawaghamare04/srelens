import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom, not node: the transport and several service modules touch
    // localStorage, window and WebSocket, and their tests assert that.
    environment: "jsdom",
    coverage: {
      provider: "v8",
      // The same floors apps/desktop enforces. Extracting the service layer
      // must not become a way to lower the bar for the code that moved.
      thresholds: { lines: 85, branches: 80, functions: 76 },
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/react.ts"],
    },
  },
});
