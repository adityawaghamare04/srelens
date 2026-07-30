import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}}>
        body
      </Drawer>,
    );
    expect(screen.queryByText("body")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("renders title and body when open, and closes via the button", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Pod · web-1" onClose={onClose}>
        body content
      </Drawer>,
    );
    expect(screen.getByText("Pod · web-1")).toBeDefined();
    expect(screen.getByText("body content")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape when open", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        body
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on Escape when closed", () => {
    const onClose = vi.fn();
    render(
      <Drawer open={false} onClose={onClose}>
        body
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lets a layered modal dialog consume Escape first (does not close the drawer)", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        body
      </Drawer>,
    );
    // Simulate an open radix dialog layered over the drawer.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    try {
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  it("does not hijack Escape while focus is in an editable field", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose}>
        <input aria-label="search" />
      </Drawer>,
    );
    const input = screen.getByLabelText("search");
    input.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
