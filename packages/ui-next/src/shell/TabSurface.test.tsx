import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { TabSurface } from "./TabSurface";

/** Holds a count so a remount would be visible: it would reset to 0. */
function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      count {n}
    </button>
  );
}

describe("TabSurface", () => {
  it("shows its child when visible", () => {
    render(<TabSurface visible><p>the table</p></TabSurface>);
    const surface = screen.getByText("the table").parentElement!;
    expect(surface.hidden).toBe(false);
  });

  it("hides rather than unmounts when not visible, so state survives", async () => {
    const { rerender } = render(<TabSurface visible><Counter /></TabSurface>);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("count 1");

    rerender(<TabSurface visible={false}><Counter /></TabSurface>);
    const surface = screen.getByRole("button", { hidden: true }).parentElement!;
    expect(surface.hidden).toBe(true);

    rerender(<TabSurface visible><Counter /></TabSurface>);
    expect(screen.getByRole("button").textContent).toBe("count 1");
  });

  it("takes the hidden tab out of the accessibility tree and the tab order", () => {
    // `hidden` does both; `display: none` alone would too, but `hidden` is the
    // attribute that says what is meant.
    render(<TabSurface visible={false}><button type="button">inside</button></TabSurface>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("fills its container", () => {
    render(<TabSurface visible><p>x</p></TabSurface>);
    const surface = screen.getByText("x").parentElement!;
    expect(surface.className).toContain("absolute");
    expect(surface.className).toContain("inset-0");
  });
});
