import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

// Only the capability wrapper is replaced. `podCount` is the one call this
// section makes, and every property below is about how its answers — and its
// non-answers — reach the rail.
const core = vi.hoisted(() => ({ podCount: vi.fn() }));
vi.mock("@srelens/core", async (orig) => ({
  ...(await orig<typeof import("@srelens/core")>()),
  ...core,
}));

import type { ClusterContext } from "@srelens/core";
import { Fleet } from "./Fleet";

function aContext(name: string): ClusterContext {
  return { name, stableId: name, cluster: name, server: `https://${name}`, isCurrent: false };
}

const PROD = aContext("prod-eu");
const STAGING = aContext("staging");
const DR = aContext("dr-us");

/** A promise that never settles: the cluster that is up but not answering. */
function neverAnswers(): Promise<never> {
  return new Promise(() => {});
}

/** One cluster's row, found by the name it is keyed under. */
function row(name: string): HTMLElement {
  const found = screen.getByText(name).closest(".kv");
  if (!found) throw new Error(`no fleet row for ${name}`);
  return found as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  core.podCount.mockResolvedValue({ counts: { running: 1, total: 1 } });
});

describe("Fleet", () => {
  it("reads each cluster's pods as a named ratio, not a bare pair of numbers", async () => {
    core.podCount.mockImplementation((context: string) =>
      Promise.resolve(
        context === "prod-eu"
          ? { counts: { running: 30, total: 33 } }
          : { counts: { running: 5, total: 5 } },
      ),
    );
    render(<Fleet clusters={[PROD, STAGING]} active={PROD} />);

    await waitFor(() => expect(within(row("prod-eu")).getByText(/30\/33/)).toBeTruthy());
    // The noun is the caller's job: "30/33" alone says nothing about what was
    // counted, the same finding the not-ready list's trailing facts came from.
    expect(row("prod-eu").textContent).toContain("30/33 running");
    expect(row("staging").textContent).toContain("5/5 running");
  });

  it("keeps every other cluster's count when one of them is unreachable", async () => {
    core.podCount.mockImplementation((context: string) =>
      Promise.resolve(
        context === "staging"
          ? { error: "dial tcp 10.1.2.3:6443: connect: connection refused" }
          : { counts: { running: 7, total: 9 } },
      ),
    );
    render(<Fleet clusters={[PROD, STAGING, DR]} active={PROD} />);

    // One cluster's failure is one row's failure — the whole point of the
    // section. The two that answered keep their numbers.
    await waitFor(() => expect(row("staging").textContent).toContain("connection refused"));
    expect(row("prod-eu").textContent).toContain("7/9 running");
    expect(row("dr-us").textContent).toContain("7/9 running");

    // And it says the cluster is unreachable, rather than only printing a
    // stack of transport text with no verdict on it.
    expect(row("staging").textContent).toContain("Unreachable");
    // Never a count: a cluster that did not answer has not said it has no pods.
    expect(row("staging").textContent).not.toContain("/");
  });

  it("does not read a timeout as a cluster with no pods", async () => {
    core.podCount.mockImplementation((context: string) =>
      Promise.resolve(
        context === "dr-us"
          ? { error: "pod count timed out" }
          : { counts: { running: 4, total: 4 } },
      ),
    );
    render(<Fleet clusters={[PROD, DR]} active={PROD} />);

    await waitFor(() => expect(row("dr-us").textContent).toContain("timed out"));
    // The exact failure this section is written against: `0/0` for a cluster
    // that never answered is a lie the reader has no way to catch.
    expect(row("dr-us").textContent).not.toContain("0");
    expect(row("dr-us").textContent).toContain("Unreachable");
  });

  it("lets the clusters that answered render while a slow one is still counting", async () => {
    core.podCount.mockImplementation((context: string) =>
      context === "staging" ? neverAnswers() : Promise.resolve({ counts: { running: 12, total: 12 } }),
    );
    render(<Fleet clusters={[PROD, STAGING, DR]} active={PROD} />);

    await waitFor(() => expect(row("prod-eu").textContent).toContain("12/12 running"));
    expect(row("dr-us").textContent).toContain("12/12 running");

    // NO AGGREGATE SPINNER. One over the section would let the slowest cluster
    // hide the two that answered, which is exactly what this asserts is not
    // happening: there is one loading indicator on screen and it is inside the
    // row that is still waiting.
    const loading = screen.getAllByRole("status");
    expect(loading).toHaveLength(1);
    expect(row("staging").contains(loading[0])).toBe(true);
  });

  it("asks every cluster at once rather than one after another", async () => {
    core.podCount.mockImplementation(() => neverAnswers());
    render(<Fleet clusters={[PROD, STAGING, DR]} active={PROD} />);

    // Three calls out with nothing having come back. A section that awaited
    // each cluster in turn would have made exactly one.
    await waitFor(() => expect(core.podCount).toHaveBeenCalledTimes(3));
    expect(core.podCount.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "prod-eu",
      "staging",
      "dr-us",
    ]);
    expect(screen.queryByText(/running/)).toBeNull();
  });

  it("shows this cluster even when the workspace list has lost it", async () => {
    // The row that must never be missing: the overview is about this cluster,
    // and a Fleet section that omitted it would be a summary of everywhere
    // except the place the reader is looking.
    render(<Fleet clusters={[STAGING]} active={PROD} />);

    await waitFor(() => expect(row("prod-eu")).toBeTruthy());
    const names = Array.from(document.querySelectorAll(".kv-k")).map((el) => el.textContent);
    expect(names).toEqual(["prod-eu", "staging"]);
  });

  it("lists a cluster once, whichever list it came from", async () => {
    render(<Fleet clusters={[PROD, STAGING]} active={PROD} />);

    await waitFor(() => expect(row("staging")).toBeTruthy());
    expect(document.querySelectorAll(".kv")).toHaveLength(2);
    expect(core.podCount).toHaveBeenCalledTimes(2);
  });
});
