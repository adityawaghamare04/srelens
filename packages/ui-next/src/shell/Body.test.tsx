import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../lib/routes", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/routes")>();
  const Fake = ({ route }: { route: string }) => <p>screen for {route}</p>;
  return { ...real, screenFor: (route: string) => (route === "/applog" ? Fake : null) };
});

import { Body } from "./Body";

describe("Body", () => {
  it("renders the screen when one is registered for the route", () => {
    render(<Body route="/applog" ported={[]} onOpenInClassic={() => {}} />);
    expect(screen.getByText("screen for /applog")).toBeDefined();
    expect(screen.queryByRole("button", { name: /open in classic/i })).toBeNull();
  });

  it("renders the Placeholder when none is", () => {
    render(<Body route="/helm" ported={[]} onOpenInClassic={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Helm" })).toBeDefined();
    expect(screen.getByRole("button", { name: /open in classic/i })).toBeDefined();
  });

  it("passes the route through to the screen", () => {
    render(<Body route="/applog" ported={[]} onOpenInClassic={() => {}} />);
    expect(screen.getByText(/\/applog/)).toBeDefined();
  });
});
