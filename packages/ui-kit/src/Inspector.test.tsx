import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inspector } from "./Inspector";

const TABS = [
  { id: "details", label: "Details" },
  { id: "containers", label: "Containers" },
  { id: "events", label: "Events" },
];

function setup(props: Partial<Parameters<typeof Inspector>[0]> = {}) {
  const onTabChange = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <Inspector
      name="checkout-api"
      subtitle="Deployment · checkout"
      tabs={TABS}
      activeTab="details"
      onTabChange={onTabChange}
      onClose={onClose}
      {...props}
    >
      {"children" in props ? props.children : <p>pane body</p>}
    </Inspector>,
  );
  return { ...view, onTabChange, onClose };
}

describe("Inspector", () => {
  it("names the subject with a heading", () => {
    // The peek is a section of the page with a title, and the title is the
    // resource. A styled span drops it out of the outline.
    setup();
    expect(screen.getByRole("heading", { level: 2, name: "checkout-api" })).toBeDefined();
  });

  it("is a region named by that heading", () => {
    // So it can nest wherever the caller docks it without inventing a second
    // complementary landmark beside Drawer's.
    setup();
    expect(screen.getByRole("region", { name: "checkout-api" })).toBeDefined();
  });

  it("renders the subtitle line", () => {
    setup();
    expect(screen.getByText("Deployment · checkout")).toBeDefined();
  });

  it("omits the subtitle line when the slot resolved to false", () => {
    const { container } = setup({ subtitle: false });
    expect(container.querySelector("header p")).toBeNull();
  });

  it("shows the status as words, not only as a colour", () => {
    setup({ status: "Degraded", statusKind: "danger" });
    expect(screen.getByText("Degraded")).toBeDefined();
  });

  it("labels every fact it shows", () => {
    // "6m" alone says nothing; the label is what makes the figure readable,
    // and the mock left age and ready unlabelled.
    setup({
      facts: [
        { label: "Ready", value: "9/12" },
        { label: "Restarts", value: "7", tone: "sev" as const },
        { label: "Age", value: "6m" },
      ],
    });
    // Paired, not merely present: a label sitting beside the wrong figure is
    // worse than none. (`term` carries no accessible name of its own, so the
    // pairing is read off the markup.)
    const ready = screen.getByText("Ready");
    expect(ready.tagName).toBe("DT");
    expect(ready.nextElementSibling?.tagName).toBe("DD");
    expect(ready.nextElementSibling?.textContent).toBe("9/12");
    expect(screen.getByText("Restarts").nextElementSibling?.textContent).toBe("7");
    expect(screen.getByText("Age").nextElementSibling?.textContent).toBe("6m");
  });

  it("keeps a toned fact readable without its colour", () => {
    // Tone is emphasis. The label and the figure carry the meaning, so a
    // reader who never sees the red still learns there are 7 restarts.
    setup({ facts: [{ label: "Restarts", value: "7", tone: "sev" as const }] });
    const value = screen.getByText("7");
    expect(value.textContent).toBe("7");
    expect(screen.getByText("Restarts")).toBeDefined();
  });

  it("names no colour of its own for a fact's tone", () => {
    const { container } = setup({ facts: [{ label: "Restarts", value: "7", tone: "sev" as const }] });
    const styled = container.querySelector<HTMLElement>("dd[style]");
    expect(styled?.style.color).toContain("var(--sev)");
  });

  it("gives the flagged marker a name instead of leaving it a red dot", () => {
    setup({ flagged: true });
    expect(screen.getByText("Needs attention")).toBeDefined();
  });

  it("shows no flag marker when the subject is not flagged", () => {
    setup();
    expect(screen.queryByText("Needs attention")).toBeNull();
  });

  it("renders the caller's header actions", () => {
    setup({ actions: <button type="button">Open tab</button> });
    expect(screen.getByRole("button", { name: "Open tab" })).toBeDefined();
  });

  it("closes from the header button", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Close inspector" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the close button when the caller owns closing", () => {
    // Docked inside a Drawer there is already one, and two are a fault.
    setup({ onClose: undefined });
    expect(screen.queryByRole("button", { name: "Close inspector" })).toBeNull();
  });

  it("gives every button it owns an explicit type", () => {
    // A bare button inside a form submits it. The kit's Button deliberately
    // does not default `type`, so each component sets its own.
    const { container } = setup();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.getAttribute("type") === "button")).toBe(true);
  });

  it("switches panes through the kit's tab strip", async () => {
    const { onTabChange } = setup();
    await userEvent.click(screen.getByRole("tab", { name: "Containers" }));
    expect(onTabChange).toHaveBeenCalledWith("containers");
  });

  it("carries the tab strip's keyboard contract rather than a second one", async () => {
    // Delegated to Tabs; asserted here so a rewrite into plain buttons is
    // caught rather than silently losing the arrow keys.
    const { onTabChange } = setup();
    screen.getByRole("tab", { name: "Details" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onTabChange).toHaveBeenLastCalledWith("containers");
  });

  it("names the tab strip when the caller says what the panes are", () => {
    setup({ tabsLabel: "Resource views" });
    expect(screen.getByRole("tablist", { name: "Resource views" })).toBeDefined();
  });

  it("renders no tab strip at all when there are no panes", () => {
    setup({ tabs: [] });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("pane body")).toBeDefined();
  });

  it("renders the body as the panel for the active tab", () => {
    setup();
    const panel = screen.getByRole("tabpanel", { name: "Details" });
    expect(panel.textContent).toContain("pane body");
  });

  it("lets the keyboard reach the scrolling body", () => {
    setup();
    expect(screen.getByRole("tabpanel", { name: "Details" }).getAttribute("tabindex")).toBe("0");
  });

  it("says so when the active pane has nothing in it", () => {
    setup({ children: null });
    expect(screen.getByText("Nothing to show")).toBeDefined();
  });

  it("takes the caller's wording for the empty pane", () => {
    setup({ children: [], emptyLabel: "No events in the last hour" });
    expect(screen.getByText("No events in the last hour")).toBeDefined();
  });

  it("treats a slot that resolved to false as empty", () => {
    setup({ children: false });
    expect(screen.getByText("Nothing to show")).toBeDefined();
  });

  it("renders the footer when there is one", () => {
    setup({ footer: <button type="button">Ask</button> });
    expect(screen.getByRole("button", { name: "Ask" })).toBeDefined();
  });

  it("omits the footer band entirely when there is nothing in it", () => {
    // A ruled empty strip is a visible artefact, not a no-op.
    const { container } = setup({ footer: false });
    expect(container.querySelector("footer")).toBeNull();
  });

  it("forwards className onto the pane", () => {
    const { container } = setup({ className: "extra" });
    expect(container.querySelector(".pane.extra")).not.toBeNull();
  });
});

/**
 * Escape backs out of the peek. Handled from inside the panel rather than on
 * the window: a component that listens globally fights every other thing that
 * does, which is the problem Drawer keeps a stack to solve.
 */
describe("Inspector keyboard behaviour", () => {
  it("closes on Escape from inside the panel", async () => {
    const { onClose } = setup();
    screen.getByRole("button", { name: "Close inspector" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone in an editable field", async () => {
    // A filter box inside a pane owns its own Escape — clearing the field
    // should not also close the panel around it.
    const { onClose } = setup({ children: <input aria-label="Filter" /> });
    screen.getByRole("textbox", { name: "Filter" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("marks Escape handled so an outer panel does not also close", async () => {
    const onOuterKeyDown = vi.fn();
    const onClose = vi.fn();
    render(
      <div onKeyDown={onOuterKeyDown}>
        <Inspector name="checkout-api" tabs={TABS} activeTab="details" onClose={onClose}>
          body
        </Inspector>
      </div>,
    );
    screen.getByRole("button", { name: "Close inspector" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOuterKeyDown.mock.calls[0][0].defaultPrevented).toBe(true);
  });

  it("does not swallow Escape when it has no way to close", async () => {
    const onOuterKeyDown = vi.fn();
    render(
      <div onKeyDown={onOuterKeyDown}>
        <Inspector name="checkout-api" tabs={TABS} activeTab="details">
          body
        </Inspector>
      </div>,
    );
    screen.getByRole("tab", { name: "Details" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onOuterKeyDown.mock.calls[0][0].defaultPrevented).toBe(false);
  });
});
