import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextApp } from "./index";

describe("NextApp", () => {
  // jsdom keeps one window.location for the whole file, so a test that
  // navigates hands the next one a gallery instead of the placeholder.
  beforeEach(() => {
    window.location.hash = "";
  });

  it("says what it is, so nobody thinks the app is broken", () => {
    // The whole new design is one placeholder at this point. Someone who opts
    // in has to be told that, not left guessing.
    render(<NextApp onExit={() => null} />);
    expect(screen.getByRole("heading", { name: /new design/i })).toBeDefined();
    expect(screen.getByText(/not.*(built|there)/i)).toBeDefined();
  });

  it("offers a way back without going through Settings", () => {
    // Settings does not exist here yet, so this button is the only exit.
    render(<NextApp onExit={() => null} />);
    expect(screen.getByRole("button", { name: /classic design/i })).toBeDefined();
  });

  it("calls back when asked to leave", async () => {
    const onExit = vi.fn().mockReturnValue(null);
    render(<NextApp onExit={onExit} />);
    await userEvent.click(screen.getByRole("button", { name: /classic design/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("shows why it could not leave, since there is no toast host here", () => {
    // The Toaster lives in the classic tree, so a failure on the way out would
    // be invisible and the button would look inert. (#314 review)
    render(<NextApp onExit={() => "storage refused the preference"} />);
    return userEvent
      .click(screen.getByRole("button", { name: /classic design/i }))
      .then(() => {
        expect(screen.getByRole("alert").textContent).toContain("storage refused");
      });
  });

  it("follows the hash after mount, not only on a fresh load", async () => {
    // Reading window.location.hash during render subscribes to nothing, so
    // navigating to #gallery left the placeholder up and navigating away left
    // the gallery up, until a reload. (#317 review)
    render(<NextApp onExit={() => null} />);
    expect(screen.getByRole("heading", { name: /new design/i })).toBeDefined();

    window.location.hash = "#gallery";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("heading", { name: /design system/i })).toBeDefined();

    window.location.hash = "";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("heading", { name: /new design/i })).toBeDefined();
  });
  it("offers a way into the component gallery", async () => {
    // The gallery has been reachable at #gallery since #317, and nothing said
    // so: switching the new design on showed a page announcing that nothing is
    // built, with twenty-four built components one hash away. A surface nobody
    // can find is one nobody reviews. (#318)
    render(<NextApp onExit={() => null} />);
    await userEvent.click(screen.getByRole("link", { name: /component gallery/i }));
    expect(await screen.findByRole("heading", { name: /design system/i })).toBeDefined();
  });

  it("says the gallery is a developer surface, not a screen", async () => {
    // So that finding it does not read as "this is what the new design is".
    render(<NextApp onExit={() => null} />);
    expect(screen.getByRole("link", { name: /component gallery/i }).textContent).toMatch(/gallery/i);
    expect(screen.getByText(/still being written/i)).toBeDefined();
  });
});
