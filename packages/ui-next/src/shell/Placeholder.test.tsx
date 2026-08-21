import type { SubmitEvent } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Placeholder } from "./Placeholder";

describe("Placeholder", () => {
  it("is a titled screen for the route, not a blank pane", () => {
    // The parent spec: a route with no ported screen must still be a routed,
    // titled, reachable screen, because users find it on their first session.
    render(<Placeholder route="/k/pods" clusterName="prod" ported={[]} onOpenInClassic={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Pods" })).toBeDefined();
  });

  it("says this screen is not in the new design yet", () => {
    render(<Placeholder route="/helm" ported={[]} onOpenInClassic={() => {}} />);
    expect(screen.getByText(/not in the new design yet/i)).toBeDefined();
  });

  it("offers to open the same place in the classic design", () => {
    const onOpenInClassic = vi.fn();
    render(<Placeholder route="/helm" ported={[]} onOpenInClassic={onOpenInClassic} />);
    fireEvent.click(screen.getByRole("button", { name: /open in classic/i }));
    expect(onOpenInClassic).toHaveBeenCalledWith("/helm");
  });

  it("lists which screens are ported, when any are", () => {
    render(<Placeholder route="/helm" ported={["Application log", "Release notes"]} onOpenInClassic={() => {}} />);
    expect(screen.getByText(/Application log/)).toBeDefined();
    expect(screen.getByText(/Release notes/)).toBeDefined();
  });

  it("says none are ported yet rather than showing an empty list", () => {
    render(<Placeholder route="/helm" ported={[]} onOpenInClassic={() => {}} />);
    expect(screen.getByText(/no screens are in the new design yet/i)).toBeDefined();
    expect(document.querySelector("ul")).toBeNull();
  });

  it("does not submit a form it is standing in", () => {
    const onSubmit = vi.fn((e: SubmitEvent<HTMLFormElement>) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Placeholder route="/helm" ported={[]} onOpenInClassic={() => {}} />
      </form>,
    );
    fireEvent.click(screen.getByRole("button", { name: /open in classic/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
