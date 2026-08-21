import { describe, it, expect } from "vitest";
import { matchWindowKey, hint } from "./shortcuts";

const ev = (
  key: string,
  mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: null, ...mods });

describe("matchWindowKey", () => {
  it("maps the table on Apple with Meta", () => {
    expect(matchWindowKey(ev("w", { metaKey: true }), true)).toEqual({ type: "close-tab" });
    expect(matchWindowKey(ev("t", { metaKey: true }), true)).toEqual({ type: "new-tab" });
    expect(matchWindowKey(ev("T", { metaKey: true, shiftKey: true }), true)).toEqual({
      type: "reopen-tab",
    });
    expect(matchWindowKey(ev("[", { metaKey: true }), true)).toEqual({ type: "prev-tab" });
    expect(matchWindowKey(ev("]", { metaKey: true }), true)).toEqual({ type: "next-tab" });
    expect(matchWindowKey(ev("3", { metaKey: true }), true)).toEqual({
      type: "select-tab",
      index: 2,
    });
    expect(matchWindowKey(ev("k", { metaKey: true }), true)).toEqual({ type: "console" });
    expect(matchWindowKey(ev("=", { metaKey: true }), true)).toEqual({ type: "zoom-in" });
    expect(matchWindowKey(ev("-", { metaKey: true }), true)).toEqual({ type: "zoom-out" });
    expect(matchWindowKey(ev("0", { metaKey: true }), true)).toEqual({ type: "zoom-reset" });
  });

  it("leaves Ctrl+W alone on Apple", () => {
    expect(matchWindowKey(ev("w", { ctrlKey: true }), true)).toBeNull();
  });

  it("uses Control elsewhere and ignores Meta there", () => {
    expect(matchWindowKey(ev("w", { ctrlKey: true }), false)).toEqual({ type: "close-tab" });
    expect(matchWindowKey(ev("w", { metaKey: true }), false)).toBeNull();
  });

  it("does not fire with Alt held or from a typing target", () => {
    expect(matchWindowKey(ev("t", { metaKey: true, altKey: true }), true)).toBeNull();
    const input = document.createElement("input");
    expect(matchWindowKey({ ...ev("t", { metaKey: true }), target: input }, true)).toBeNull();
  });

  it("lets the console key through from a typing target", () => {
    const input = document.createElement("input");
    expect(matchWindowKey({ ...ev("k", { metaKey: true }), target: input }, true)).toEqual({
      type: "console",
    });
  });

  it("prints hints per platform", () => {
    expect(hint("new-tab", true)).toBe("⌘T");
    expect(hint("new-tab", false)).toBe("Ctrl+T");
    // Core runs the modifiers in the order the chord lists them, so `Mod` first.
    expect(hint("reopen-tab", true)).toBe("⌘⇧T");
  });
});
