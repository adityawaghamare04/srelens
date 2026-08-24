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

import { scaledStatus, type ClusterContext } from "@srelens/core";
import { statusTone, toneColor } from "@srelens/ui-kit";
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

/**
 * The count's colour. §7 draws `1 284 / 1 310` in red beside `1 702 / 1 702`
 * in green, and that is what makes the section scannable.
 *
 * Three states in the fixture, not one. A table that paired the wrong colour
 * with the wrong state has passed a two-state suite before on this project,
 * because the fixture only ever contained the case both readings agreed on.
 */
describe("Fleet's tone", () => {
  const colour = (name: string) =>
    row(name).querySelector<HTMLElement>(".kv-v span")?.style.color ?? "";

  /** What core says about the same two numbers, read the way the screen reads it. */
  const fromCore = (running: number, total: number) =>
    statusTone(scaledStatus("Cluster", running, total).health);

  it("takes the colour from core's verdict on the same two numbers", async () => {
    core.podCount.mockImplementation((context: string) =>
      Promise.resolve(
        context === "prod-eu"
          ? { counts: { running: 1284, total: 1310 } }
          : context === "staging"
            ? { counts: { running: 1702, total: 1702 } }
            : // Every countable pod gone — `total` excludes `Succeeded`, so a
              // cluster whose Jobs have all finished lands here. Core calls it
              // neither well nor broken, and so does the row.
              { counts: { running: 0, total: 0 } },
      ),
    );
    render(<Fleet clusters={[PROD, STAGING, DR]} active={PROD} />);

    await waitFor(() => expect(row("prod-eu").textContent).toContain("1284/1310 running"));

    // Three distinct answers, so a single wrong pairing cannot pass by
    // agreeing with the one case the fixture happens to contain.
    expect(new Set([fromCore(1284, 1310), fromCore(1702, 1702), fromCore(0, 0)]).size).toBe(3);

    expect(colour("prod-eu")).toBe(toneColor(fromCore(1284, 1310)));
    expect(colour("staging")).toBe(toneColor(fromCore(1702, 1702)));
    expect(colour("dr-us")).toBe(toneColor(fromCore(0, 0)));

    // And what core actually says, spelled out: a shortfall is danger and a
    // whole count is ok. Written as core's own constants rather than as
    // literals, so this asserts the wiring and not a second copy of the rule.
    expect(colour("prod-eu")).toBe(toneColor(statusTone("danger")));
    expect(colour("staging")).toBe(toneColor(statusTone("success")));
  });

  it("names no colour of its own — every one is a token", async () => {
    core.podCount.mockResolvedValue({ counts: { running: 3, total: 4 } });
    render(<Fleet clusters={[PROD]} active={PROD} />);
    await waitFor(() => expect(row("prod-eu").textContent).toContain("3/4 running"));

    expect(colour("prod-eu")).toMatch(/^var\(--/);
  });

  it("keeps the figure in words, so the colour is never the only channel", async () => {
    core.podCount.mockResolvedValue({ counts: { running: 1284, total: 1310 } });
    render(<Fleet clusters={[PROD]} active={PROD} />);
    await waitFor(() =>
      expect(row("prod-eu").querySelector(".kv-v")?.textContent).toBe("1284/1310 running"),
    );
  });

  it("colours nothing at all for a cluster that did not answer", async () => {
    // There is no count to tone. A red "Unreachable" would be a judgement
    // about a cluster nobody reached.
    core.podCount.mockResolvedValue({ error: "pod count timed out" });
    render(<Fleet clusters={[PROD]} active={PROD} />);
    await waitFor(() => expect(row("prod-eu").textContent).toContain("Unreachable"));

    expect(row("prod-eu").textContent).not.toContain("0/0");
    expect(colour("prod-eu")).toBe("");
  });
});
