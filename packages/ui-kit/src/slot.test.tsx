import { describe, it, expect } from "vitest";
import { filled } from "./slot";

describe("filled", () => {
  it("accepts anything that renders", () => {
    expect(filled("text")).toBe(true);
    expect(filled(0)).toBe(true);
    expect(filled(<span />)).toBe(true);
  });

  it("rejects what renders nothing", () => {
    expect(filled(null)).toBe(false);
    expect(filled(undefined)).toBe(false);
    expect(filled("")).toBe(false);
  });

  it("rejects the boolean a conditional slot hands over", () => {
    // `action={canCreate && <Button />}` is the ordinary way to make a slot
    // conditional, and it passes `false`, not nothing. (#325 review)
    expect(filled(false)).toBe(false);
    expect(filled(true)).toBe(false);
  });

  it("keeps zero, which renders", () => {
    // A count of 0 is a real thing to show; dropping it would hide a figure
    // the caller meant to display.
    expect(filled(0)).toBe(true);
  });
});
