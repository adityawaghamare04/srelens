import { describe, it, expect, beforeEach } from "vitest";
import { defaultMark, getMark, setMark, resetMark, loadMarks, useMark, MARKS_KEY } from "./marks";

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}

describe("marks", () => {
  it("derives initials", () => {
    expect(defaultMark("prod-eu").short).toBe("PE");
    expect(defaultMark("staging").short).toBe("ST");
    expect(defaultMark("a-b-c-d").short).toBe("AB");
  });
  it("persists a set mark and reads it back after a reload", () => {
    const s = fakeStorage();
    loadMarks(s);
    setMark("prod", { ...defaultMark("prod-eu"), color: "var(--ok)" }, s);
    expect(JSON.parse(s.m.get(MARKS_KEY)!).prod.color).toBe("var(--ok)");
    loadMarks(fakeStorage()); // forget
    loadMarks(s);
    expect(getMark("prod", "prod-eu").color).toBe("var(--ok)");
  });
  it("resets to the default and survives a throwing storage", () => {
    const s = fakeStorage();
    loadMarks(s);
    setMark("prod", { ...defaultMark("prod-eu"), short: "ZZ" }, s);
    resetMark("prod", s);
    expect(getMark("prod", "prod-eu").short).toBe("PE");
    const bad = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => {} };
    expect(() => loadMarks(bad)).not.toThrow();
    expect(() => setMark("x", defaultMark("x"), bad)).not.toThrow();
  });
});

describe("marks the shell reads", () => {
  beforeEach(() => loadMarks(fakeStorage()));

  it("keeps a renamed cluster's colours but not its stale name", () => {
    const s = fakeStorage();
    loadMarks(s);
    setMark("prod", { ...defaultMark("prod-eu"), color: "var(--ok)" }, s);
    const after = getMark("prod", "prod-eu-1");
    expect(after.name).toBe("prod-eu-1");
    expect(after.color).toBe("var(--ok)");
    expect(after.short).toBe("PE");
  });

  it("returns the same object until the mark changes", () => {
    // `useSyncExternalStore` re-renders forever on a snapshot that is a fresh
    // object every read, and every unstored cluster reads a fresh default.
    const s = fakeStorage();
    loadMarks(s);
    expect(getMark("prod", "prod-eu")).toBe(getMark("prod", "prod-eu"));
    setMark("prod", { ...defaultMark("prod-eu"), color: "var(--ok)" }, s);
    expect(getMark("prod", "prod-eu")).toBe(getMark("prod", "prod-eu"));
  });

  it("ignores a document that is not a map of marks", () => {
    const s = fakeStorage();
    for (const raw of ["[]", "null", "7", "{oops", '{"prod":3}']) {
      s.m.set(MARKS_KEY, raw);
      loadMarks(s);
      expect(getMark("prod", "prod-eu").color).toBe("var(--accent)");
    }
  });

  it("re-renders a subscriber when its mark is set and reset", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const s = fakeStorage();
    loadMarks(s);
    const { result } = renderHook(() => useMark("prod", "prod-eu"));
    expect(result.current.color).toBe("var(--accent)");
    act(() => setMark("prod", { ...defaultMark("prod-eu"), color: "var(--ok)" }, s));
    expect(result.current.color).toBe("var(--ok)");
    act(() => resetMark("prod", s));
    expect(result.current.color).toBe("var(--accent)");
  });
});
