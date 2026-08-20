import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextApp } from "./index";

describe("NextApp", () => {
  it("says what it is, so nobody thinks the app is broken", () => {
    // The whole new design is one placeholder at this point. Someone who opts
    // in has to be told that, not left guessing.
    render(<NextApp onExit={() => {}} />);
    expect(screen.getByRole("heading", { name: /new design/i })).toBeDefined();
    expect(screen.getByText(/not.*(built|there)/i)).toBeDefined();
  });

  it("offers a way back without going through Settings", () => {
    // Settings does not exist here yet, so this button is the only exit.
    render(<NextApp onExit={() => {}} />);
    expect(screen.getByRole("button", { name: /classic design/i })).toBeDefined();
  });

  it("calls back when asked to leave", async () => {
    const onExit = vi.fn();
    render(<NextApp onExit={onExit} />);
    await userEvent.click(screen.getByRole("button", { name: /classic design/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
