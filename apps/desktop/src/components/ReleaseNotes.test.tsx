import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReleaseNotes } from "./ReleaseNotes";

describe("ReleaseNotes", () => {
  it("renders headings and bullets as real elements, not raw markdown", () => {
    const { container } = render(
      <ReleaseNotes notes={"### Features\n- **forward:** saved forwards (#173)\n- web mode (#165)"} />,
    );
    expect(screen.getByRole("heading", { name: "Features" })).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("forward:");
    // The regression this guards: markdown syntax leaking through as text.
    expect(container.textContent).not.toContain("###");
    expect(container.textContent).not.toContain("**");
  });

  it("renders inline code from dev-channel notes", () => {
    const { container } = render(<ReleaseNotes notes={"**Commit:** `deadbeef`"} />);
    expect(container.querySelector("code")?.textContent).toBe("deadbeef");
  });

  it("renders nothing when there are no notes", () => {
    const { container } = render(<ReleaseNotes notes="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("escapes markup in note text rather than injecting it", () => {
    const { container } = render(<ReleaseNotes notes={"- <img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
