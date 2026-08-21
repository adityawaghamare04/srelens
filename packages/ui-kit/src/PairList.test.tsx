import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PairList } from "./PairList";

/** New: the mock shipped this component with no tests at all. (#320) */
describe("PairList", () => {
  const pairs: Array<[string, string]> = [
    ["app", "web"],
    ["app.kubernetes.io/managed-by", "Helm"],
  ];

  it("prints each pair the way kubectl does", () => {
    const { container } = render(<PairList pairs={pairs} />);
    expect(Array.from(container.querySelectorAll("li")).map((e) => e.textContent)).toEqual([
      "app=web",
      "app.kubernetes.io/managed-by=Helm",
    ]);
  });

  it("is a list, and says so", () => {
    // Labels and annotations are a set of things, and how many there are is
    // part of reading them.
    render(<PairList pairs={pairs} />);
    expect(screen.getByRole("list")).toBeDefined();
    expect(screen.getAllByRole("listitem").length).toBe(2);
  });

  it("keeps each pair on one line by default", () => {
    // A wall of annotations is scanned by key; a value that wraps to four
    // lines buries the next key.
    const { container } = render(<PairList pairs={pairs} />);
    const row = container.querySelector("li");
    expect(row?.className).toContain("truncate");
    expect(container.querySelector(".v")?.className).not.toContain("break-all");
  });

  it("lets long values wrap when asked", () => {
    const { container } = render(<PairList pairs={pairs} breakValues />);
    const row = container.querySelector("li");
    expect(row?.className ?? "").not.toContain("truncate");
    expect(container.querySelector(".v")?.className).toContain("break-all");
  });

  it("hangs the whole pair off the row as a title", () => {
    // The truncated row is the one that most needs reading in full.
    const { container } = render(<PairList pairs={pairs} />);
    expect(container.querySelector("li")?.getAttribute("title")).toBe("app=web");
  });

  it("renders nothing at all for an empty list", () => {
    // `.pairs` sets a line-height and sits between two blocks; an empty one is
    // a gap the caller did not ask for.
    const { container } = render(<PairList pairs={[]} />);
    expect(container.querySelector(".pairs")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("forwards className onto the list", () => {
    const { container } = render(<PairList pairs={pairs} className="extra" />);
    expect(container.querySelector(".pairs.extra")).not.toBeNull();
  });
});
