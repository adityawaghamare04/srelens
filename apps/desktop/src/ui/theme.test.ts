import { describe, it, expect, beforeEach } from "vitest";
import { getInitialTheme, applyTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-mode");
  document.documentElement.removeAttribute("data-theme-preference");
  document.documentElement.classList.remove("dark");
});

describe("theme", () => {
  it("defaults to the Slate dark theme", () => {
    expect(getInitialTheme()).toEqual({ name: "slate", mode: "dark" });
  });

  it("applies and persists a named light theme, and reads it back", () => {
    applyTheme({ name: "srelens", mode: "light" });
    expect(document.documentElement.dataset.theme).toBe("srelens");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(getInitialTheme()).toEqual({ name: "srelens", mode: "light" });
  });

  it("marks dark with both data attributes and the shadcn `dark` class", () => {
    applyTheme({ name: "graphite", mode: "light" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    applyTheme({ name: "graphite", mode: "dark" });
    expect(document.documentElement.dataset.theme).toBe("graphite");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(getInitialTheme()).toEqual({ name: "graphite", mode: "dark" });
  });

  it("migrates the old string preference into the default palette", () => {
    localStorage.setItem("fl-theme", "light");
    expect(getInitialTheme()).toEqual({ name: "slate", mode: "light" });
  });

  it("migrates removed palette names into the default palette", () => {
    localStorage.setItem("fl-theme-v2", JSON.stringify({ name: "supabase", mode: "dark" }));
    expect(getInitialTheme()).toEqual({ name: "slate", mode: "dark" });
  });
});
