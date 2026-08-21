import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No pods" />);
    expect(screen.getByText("No pods")).toBeDefined();
  });

  it("renders a title given as a node, not just a string", () => {
    render(<EmptyState title={<em>No pods</em>} />);
    expect(screen.getByText("No pods").tagName).toBe("EM");
  });

  it("renders the hint when one is given", () => {
    render(<EmptyState title="No pods" hint="Nothing is scheduled in this namespace." />);
    expect(screen.getByText("Nothing is scheduled in this namespace.")).toBeDefined();
  });

  it("omits the hint element, not just its text, when none is given", () => {
    // An empty hint line is still a line: it holds vertical space and pushes
    // the action away from the title.
    const { container } = render(<EmptyState title="No pods" />);
    expect(container.querySelector('[data-slot="hint"]')).toBeNull();
  });

  it("renders the caller's action control as given", () => {
    render(<EmptyState title="No pods" action={<button type="button">Create pod</button>} />);
    // The slot is for a control the caller owns, so it arrives intact rather
    // than as a label this component wraps in a button of its own.
    expect(screen.getByRole("button", { name: "Create pod" })).toBeDefined();
  });

  it("omits the action element, not just its content, when none is given", () => {
    const { container } = render(<EmptyState title="No pods" />);
    expect(container.querySelector('[data-slot="action"]')).toBeNull();
  });

  it("keeps the title as the only content when nothing else is given", () => {
    const { container } = render(<EmptyState title="No pods" />);
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it("forwards className onto the root", () => {
    const { container } = render(<EmptyState title="No pods" className="extra" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains("extra")).toBe(true);
    // Merged, not replacing the component's own layout classes.
    expect(root.className.trim()).not.toBe("extra");
  });

  it("announces nothing: a loaded-but-empty result is not a status", () => {
    // LoadingState owns the live region for an in-flight load; an empty result
    // that also announced itself would double up on the same content area.
    const { container } = render(<EmptyState title="No pods" />);
    expect(container.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });
  it("treats a conditional slot that resolved to false as absent", () => {
    // `action={canCreate && <Button />}` passes `false`. The wrapper would
    // still take its margin, leaving the gap the caller meant to remove.
    // (#325 review)
    const { container } = render(<EmptyState title="No pods" hint={false} action={false} />);
    expect(container.querySelector('[data-slot="hint"]')).toBeNull();
    expect(container.querySelector('[data-slot="action"]')).toBeNull();
  });
});
