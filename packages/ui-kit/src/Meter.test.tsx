import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Meter } from "./Meter";

describe("Meter", () => {
  it("reports its value to assistive technology, not only visually", () => {
    render(<Meter value={30} ariaLabel="Memory" />);
    const meter = screen.getByRole("meter", { name: "Memory" });
    expect(meter.getAttribute("aria-valuenow")).toBe("30");
    expect(meter.getAttribute("aria-valuemax")).toBe("100");
  });

  it("picks a tone from the value, so a column of meters reads as a heat map", () => {
    const { container: ok } = render(<Meter value={10} />);
    expect(ok.querySelector<HTMLElement>(".h-full")?.style.background).toContain("--ok");
    const { container: warn } = render(<Meter value={70} />);
    expect(warn.querySelector<HTMLElement>(".h-full")?.style.background).toContain("--warn");
    const { container: sev } = render(<Meter value={95} />);
    expect(sev.querySelector<HTMLElement>(".h-full")?.style.background).toContain("--sev");
  });

  it("clamps the bar past 100 but keeps the real number", () => {
    // A pod over its limit genuinely reports more than 100%. The bar must not
    // run past its track — that reads as a rendering fault rather than a
    // reading — but hiding the true figure would be worse.
    const { container } = render(<Meter value={150} />);
    expect(container.querySelector<HTMLElement>(".h-full")?.style.width).toBe("100%");
    expect(screen.getByText("150%")).toBeDefined();
  });

  it("does not render backwards for a negative value", () => {
    const { container } = render(<Meter value={-5} />);
    expect(container.querySelector<HTMLElement>(".h-full")?.style.width).toBe("0%");
  });
});
