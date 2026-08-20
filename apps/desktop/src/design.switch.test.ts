import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { isTauriMock, setDecorationsMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  setDecorationsMock: vi.fn(),
}));
vi.mock("@srelens/core/platform", () => ({ isTauri: isTauriMock, isWeb: () => false }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setDecorations: setDecorationsMock }),
}));

import { DESIGN_KEY, switchDesign } from "./design";

const reload = vi.fn();
let originalLocation: Location;

beforeEach(() => {
  localStorage.clear();
  reload.mockClear();
  setDecorationsMock.mockReset().mockResolvedValue(undefined);
  isTauriMock.mockReturnValue(true);
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("switchDesign", () => {
  it("saves the choice and reloads", async () => {
    await switchDesign("next");
    expect(localStorage.getItem(DESIGN_KEY)).toBe("next");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("drops the window decorations for the new design and restores them for classic", async () => {
    await switchDesign("next");
    expect(setDecorationsMock).toHaveBeenCalledWith(false);
    setDecorationsMock.mockClear();
    await switchDesign("classic");
    expect(setDecorationsMock).toHaveBeenCalledWith(true);
  });

  it("still reloads when setting the decorations fails", async () => {
    // `core:window:allow-set-decorations` is not granted by default, so this
    // call throws on a build whose capabilities have not been updated. The
    // decorations are cosmetic; the switch is not, and a rejected promise here
    // left the user staring at an unchanged window with the preference already
    // written — the design would only appear on the next manual restart.
    setDecorationsMock.mockRejectedValue(new Error("window.set_decorations not allowed"));
    await switchDesign("next");
    expect(localStorage.getItem(DESIGN_KEY)).toBe("next");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on web, where there are no decorations to set", async () => {
    isTauriMock.mockReturnValue(false);
    await switchDesign("next");
    expect(setDecorationsMock).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
