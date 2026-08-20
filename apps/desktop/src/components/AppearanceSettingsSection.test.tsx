import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { switchDesignMock } = vi.hoisted(() => ({ switchDesignMock: vi.fn() }));
vi.mock("../design", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../design")>()),
  switchDesign: switchDesignMock,
}));

import { AppearanceSettingsSection } from "./AppearanceSettingsSection";

beforeEach(() => {
  switchDesignMock.mockClear();
  localStorage.clear();
});

describe("AppearanceSettingsSection", () => {
  it("says the new design is unfinished, before anyone opts in", () => {
    // Shipping a half-built UI behind a toggle is only defensible if the
    // toggle says so. Someone who opts in and finds empty screens should have
    // been told, not surprised.
    render(<AppearanceSettingsSection />);
    // Said in the description, not only in the button label — someone scanning
    // the setting should learn it without reading the options.
    expect(screen.getByText(/most screens are not there yet/i)).toBeDefined();
  });

  it("warns that switching reloads the window", () => {
    render(<AppearanceSettingsSection />);
    expect(screen.getByText(/reload/i)).toBeDefined();
  });

  it("switches to the new design when asked", async () => {
    render(<AppearanceSettingsSection />);
    await userEvent.click(screen.getByRole("button", { name: /new design/i }));
    expect(switchDesignMock).toHaveBeenCalledWith("next");
  });

  it("marks the design in use, so the current state is visible", () => {
    render(<AppearanceSettingsSection />);
    // No jest-dom in this project, so read the attribute directly.
    expect(
      screen.getByRole("button", { name: /classic design/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("does not reload when the chosen design is already active", async () => {
    // Re-picking the current design should be inert, not a pointless reload.
    render(<AppearanceSettingsSection />);
    await userEvent.click(screen.getByRole("button", { name: /classic design/i }));
    expect(switchDesignMock).not.toHaveBeenCalled();
  });
});
