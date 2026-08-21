// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defaultState, makeTab, type TabsState } from "./tabs";
import {
  STORAGE_KEY, STORAGE_VERSION, flushSave, loadTabsState, parseStoredState, saveTabsState, scheduleSave,
  installFlushOnUnload, type Storage,
} from "./tabsPersist";

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const valid = (): TabsState => {
  const s = defaultState([]);
  s.workspaces[0].tabs.push(makeTab("/k/pods", { clusterName: "c" }));
  return s;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => { flushSave(); vi.useRealTimers(); });

describe("parseStoredState", () => {
  it("round-trips a state written by saveTabsState", () => {
    const storage = memory();
    const state = valid();
    saveTabsState(state, storage);
    expect(parseStoredState(storage.getItem(STORAGE_KEY))).toEqual(state);
  });

  it("returns null for nothing, for garbage, and for the wrong shape", () => {
    expect(parseStoredState(null)).toBeNull();
    expect(parseStoredState("not json")).toBeNull();
    expect(parseStoredState(JSON.stringify({ version: STORAGE_VERSION, workspaces: "nope" }))).toBeNull();
    expect(parseStoredState(JSON.stringify({ version: STORAGE_VERSION, workspaces: [], currentId: 1 }))).toBeNull();
  });

  it("refuses a document from a future version rather than half-applying it", () => {
    const storage = memory();
    saveTabsState(valid(), storage);
    const doc = JSON.parse(storage.getItem(STORAGE_KEY)!);
    doc.version = STORAGE_VERSION + 1;
    expect(parseStoredState(JSON.stringify(doc))).toBeNull();
  });

  it("drops fields it does not know and tabs that are malformed", () => {
    const doc = {
      version: STORAGE_VERSION,
      currentId: "w",
      stray: true,
      workspaces: [{
        id: "w", name: "N", clusters: ["a"], activeId: "t1", closed: [], extra: 1,
        tabs: [
          { id: "t1", route: "/", title: "Home", kind: "control", pinned: true, junk: "x" },
          { id: 7, route: "/bad" },
          "nope",
        ],
      }],
    };
    const out = parseStoredState(JSON.stringify(doc))!;
    expect(out.workspaces[0].tabs).toEqual([{ id: "t1", route: "/", title: "Home", kind: "control", pinned: true }]);
    expect((out as unknown as { stray?: unknown }).stray).toBeUndefined();
    expect((out.workspaces[0] as unknown as { extra?: unknown }).extra).toBeUndefined();
  });
});

describe("loadTabsState", () => {
  it("reads from the given storage", () => {
    const storage = memory();
    const state = valid();
    saveTabsState(state, storage);
    expect(loadTabsState(storage, () => true)).toEqual(state);
  });

  it("returns null when the user has turned session restore off", () => {
    // Classic honours the same preference; the new design must not be the
    // one place that remembers anyway.
    const storage = memory();
    saveTabsState(valid(), storage);
    expect(loadTabsState(storage, () => false)).toBeNull();
  });

  it("returns null when nothing was saved", () => {
    expect(loadTabsState(memory(), () => true)).toBeNull();
  });
});

describe("scheduleSave / flushSave", () => {
  it("debounces, writing once after the delay", () => {
    const storage = memory();
    const spy = vi.spyOn(storage, "setItem");
    scheduleSave(valid(), storage, 300);
    scheduleSave(valid(), storage, 300);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("writes the latest state, not the first scheduled", () => {
    const storage = memory();
    const a = valid();
    const b = valid();
    b.workspaces[0].name = "Later";
    scheduleSave(a, storage, 300);
    scheduleSave(b, storage, 300);
    vi.advanceTimersByTime(300);
    expect(parseStoredState(storage.getItem(STORAGE_KEY))?.workspaces[0].name).toBe("Later");
  });

  it("flush writes immediately and cancels the timer", () => {
    const storage = memory();
    const spy = vi.spyOn(storage, "setItem");
    scheduleSave(valid(), storage, 300);
    flushSave();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing pending writes nothing", () => {
    const storage = memory();
    const spy = vi.spyOn(storage, "setItem");
    flushSave();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("installFlushOnUnload", () => {
  it("flushes on beforeunload and detaches when told", () => {
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (n: string, h: () => void) => void handlers.set(n, h),
      removeEventListener: (n: string) => void handlers.delete(n),
    } as unknown as Window;
    const storage = memory();
    const spy = vi.spyOn(storage, "setItem");
    const off = installFlushOnUnload(target);
    scheduleSave(valid(), storage, 300);
    handlers.get("beforeunload")!();
    expect(spy).toHaveBeenCalledTimes(1);
    off();
    expect(handlers.has("beforeunload")).toBe(false);
  });
});
