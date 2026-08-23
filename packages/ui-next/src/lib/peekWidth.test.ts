import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_PEEK_WIDTH,
  MAX_PEEK_WIDTH,
  MIN_LIST_WIDTH,
  MIN_PEEK_WIDTH,
  PEEK_WIDTH_KEY,
  loadPeekWidth,
  peekWidth,
  savePeekWidth,
  setPeekWidth,
} from "./peekWidth";

/** jsdom's window is 1024 wide; every bound below is stated against that. */
const VIEWPORT = 1024;

function widen(px: number) {
  Object.defineProperty(window, "innerWidth", { value: px, configurable: true, writable: true });
}

describe("the peek's width", () => {
  beforeEach(() => {
    localStorage.clear();
    widen(VIEWPORT);
    loadPeekWidth();
  });

  afterEach(() => widen(VIEWPORT));

  it("opens at the width the pane shipped as", () => {
    expect(peekWidth().width).toBe(DEFAULT_PEEK_WIDTH);
  });

  it("survives a reload", () => {
    savePeekWidth(480);
    loadPeekWidth();
    expect(peekWidth().width).toBe(480);
  });

  it("hands back the same object until something changes, so a subscriber cannot tear", () => {
    // `useSyncExternalStore` tears down and re-renders forever on a snapshot
    // that is a fresh object every read, and this one is composed.
    expect(peekWidth()).toBe(peekWidth());
    setPeekWidth(400);
    expect(peekWidth().width).toBe(400);
    expect(peekWidth()).toBe(peekWidth());
  });

  it("refuses a width the pane cannot honour", () => {
    savePeekWidth(MAX_PEEK_WIDTH + 400);
    expect(peekWidth().width).toBe(MAX_PEEK_WIDTH);
    savePeekWidth(20);
    expect(peekWidth().width).toBe(MIN_PEEK_WIDTH);
  });

  it("leaves the list room, so the peek can never take the whole window", () => {
    widen(MIN_LIST_WIDTH + MIN_PEEK_WIDTH + 40);
    expect(peekWidth().maxWidth).toBe(MIN_PEEK_WIDTH + 40);
    // Narrower than both together: the pane stays usable and the table
    // scrolls inside itself rather than the peek shrinking to a sliver.
    widen(400);
    expect(peekWidth().maxWidth).toBe(MIN_PEEK_WIDTH);
    expect(peekWidth().minWidth).toBe(MIN_PEEK_WIDTH);
  });

  it("clamps a stored width against the window it is restored into, not the one it was set in", () => {
    // The reader dragged it wide on a big display and reopened the app in a
    // small window; honouring that number leaves no table at all.
    localStorage.setItem(PEEK_WIDTH_KEY, JSON.stringify(MAX_PEEK_WIDTH));
    loadPeekWidth();
    expect(peekWidth().width).toBe(MAX_PEEK_WIDTH);
    widen(MIN_LIST_WIDTH + 300);
    expect(peekWidth().width).toBe(300);
  });

  it("reads nonsense as no stored width at all", () => {
    for (const raw of ['"wide"', "null", "{}", "0", "-40", "not json"]) {
      localStorage.setItem(PEEK_WIDTH_KEY, raw);
      loadPeekWidth();
      expect(peekWidth().width, raw).toBe(DEFAULT_PEEK_WIDTH);
    }
  });

  it("costs the width and nothing else when storage refuses", () => {
    const throwing = {
      getItem() {
        throw new DOMException("denied");
      },
      setItem() {
        throw new DOMException("denied");
      },
      removeItem() {
        throw new DOMException("denied");
      },
    };
    expect(() => loadPeekWidth(throwing)).not.toThrow();
    expect(peekWidth().width).toBe(DEFAULT_PEEK_WIDTH);
    expect(() => savePeekWidth(400, throwing)).not.toThrow();
    // The drag still worked; only the memory of it was lost.
    expect(peekWidth().width).toBe(400);
  });

  it("only writes when the resize settles", () => {
    setPeekWidth(400);
    expect(peekWidth().width).toBe(400);
    // Every pixel of a drag comes through `setPeekWidth`; a write per pixel is
    // what `ResizeHandle`'s two callbacks exist to avoid.
    expect(localStorage.getItem(PEEK_WIDTH_KEY)).toBeNull();
    savePeekWidth(400);
    expect(localStorage.getItem(PEEK_WIDTH_KEY)).toBe("400");
  });
});
