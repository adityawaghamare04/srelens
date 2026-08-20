import { describe, it, expect, vi, beforeEach } from "vitest";

const { getInitialThemeMock, resolvedThemeModeMock } = vi.hoisted(() => ({
  getInitialThemeMock: vi.fn(),
  resolvedThemeModeMock: vi.fn(),
}));
vi.mock("./ui/theme", () => ({
  getInitialTheme: getInitialThemeMock,
  resolvedThemeMode: resolvedThemeModeMock,
}));

import { applyNextDesignTheme } from "./design";

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  getInitialThemeMock.mockReturnValue({ name: "slate", mode: "dark" });
  resolvedThemeModeMock.mockImplementation((mode: string) => mode);
});

describe("applyNextDesignTheme", () => {
  it("carries a dark preference into the new design's convention", () => {
    // The classic default IS dark, so getting this wrong sends most users to a
    // bright UI on every launch. The two designs disagree about data-theme:
    // classic puts the palette name there, ui-next reads it as the mode.
    applyNextDesignTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("uses the absence of the attribute for light, matching :root", () => {
    getInitialThemeMock.mockReturnValue({ name: "slate", mode: "light" });
    document.documentElement.dataset.theme = "dark";
    applyNextDesignTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("resolves a system preference rather than passing it through", () => {
    // "system" is not one of ui-next's selectors; leaving it would match none
    // of them and silently fall back to light.
    getInitialThemeMock.mockReturnValue({ name: "slate", mode: "system" });
    resolvedThemeModeMock.mockReturnValue("dark");
    applyNextDesignTheme();
    expect(resolvedThemeModeMock).toHaveBeenCalledWith("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("never leaves the classic palette name where ui-next reads a mode", () => {
    // `data-theme="slate"` matches none of ui-next's blocks.
    getInitialThemeMock.mockReturnValue({ name: "slate", mode: "dark" });
    applyNextDesignTheme();
    expect(document.documentElement.dataset.theme).not.toBe("slate");
  });
});
