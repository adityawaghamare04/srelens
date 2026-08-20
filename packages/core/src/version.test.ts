import { describe, it, expect } from "vitest";
import { CORE_PACKAGE } from "./index";

describe("@srelens/core", () => {
  it("resolves as a workspace package", () => {
    expect(CORE_PACKAGE).toBe("@srelens/core");
  });
});
