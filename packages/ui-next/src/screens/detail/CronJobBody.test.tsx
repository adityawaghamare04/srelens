import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { jobStatus, type JobSummary, type K8sObject } from "@srelens/core";

// The "Recent Jobs" section reads live Jobs for the CronJob's namespace via
// core's `listJobs` — mocked here so a test controls what "the cluster said"
// without one. `importOriginal` keeps every formatter (`timestampWithAge`,
// `str`, `asRecord`, ...) intact.
const { listJobs } = vi.hoisted(() => ({
  listJobs: vi.fn(async (): Promise<{ jobs?: JobSummary[]; error?: string }> => ({ jobs: [] })),
}));

vi.mock("@srelens/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@srelens/core")>()),
  listJobs,
}));

import { GenericBody } from "./GenericBody";
import { detailFacts } from "./detailData";
import { CronJobDetailsBody } from "./CronJobBody";

function cronjob(
  spec: Record<string, unknown>,
  status: Record<string, unknown> = {},
  metadata: NonNullable<K8sObject["metadata"]> = { name: "nightly-backup", namespace: "default" },
): K8sObject {
  return { kind: "CronJob", apiVersion: "batch/v1", metadata, spec, status } as K8sObject;
}

const MINE: JobSummary = {
  name: "nightly-backup-28712345",
  namespace: "default",
  completions: "1/1",
  active: 0,
  failed: 0,
  duration: "45s",
  owner: "nightly-backup",
  age: "1h",
};

const OTHER: JobSummary = {
  name: "other-job-1",
  namespace: "default",
  completions: "1/1",
  active: 0,
  failed: 0,
  duration: "10s",
  owner: "some-other-cronjob",
  age: "1h",
};

describe("CronJobDetailsBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listJobs.mockResolvedValue({ jobs: [] });
  });

  describe("Schedule", () => {
    it("shows the cron expression and concurrency policy", () => {
      render(
        <CronJobDetailsBody
          object={cronjob({ schedule: "0 2 * * *", concurrencyPolicy: "Forbid" })}
          context="ctx"
        />,
      );
      expect(screen.getByText("0 2 * * *")).toBeDefined();
      expect(screen.getByText("Forbid")).toBeDefined();
    });

    it("shows Suspend as Yes when the CronJob is suspended", () => {
      render(<CronJobDetailsBody object={cronjob({ suspend: true })} context="ctx" />);
      expect(screen.getByText("Yes")).toBeDefined();
    });

    it("shows Suspend as No when the CronJob is not suspended", () => {
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      expect(screen.getByText("No")).toBeDefined();
    });

    it("shows the last schedule time", () => {
      render(
        <CronJobDetailsBody
          object={cronjob({}, { lastScheduleTime: "2026-08-20T00:00:00Z" })}
          context="ctx"
        />,
      );
      expect(screen.getByText(/ago \(/)).toBeDefined();
    });

    it("shows a dash for last schedule on a CronJob that has never run", () => {
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      expect(screen.getByText("—")).toBeDefined();
    });

    it("shows history retention, defaulting to 3 succeeded / 1 failed", () => {
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      expect(screen.getByText("3 succeeded, 1 failed")).toBeDefined();
    });

    it("shows explicit history retention limits", () => {
      render(
        <CronJobDetailsBody
          object={cronjob({ successfulJobsHistoryLimit: 5, failedJobsHistoryLimit: 2 })}
          context="ctx"
        />,
      );
      expect(screen.getByText("5 succeeded, 2 failed")).toBeDefined();
    });

    it("shows active jobs as inert Kind/name text", () => {
      render(
        <CronJobDetailsBody
          object={cronjob({}, { active: [{ kind: "Job", name: "nightly-backup-28712345" }] })}
          context="ctx"
        />,
      );
      expect(screen.getByText("Job/nightly-backup-28712345")).toBeDefined();
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });

    it("shows 0 active jobs when none are running", () => {
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      expect(screen.getByText("0")).toBeDefined();
    });
  });

  describe("Recent Jobs", () => {
    it("shows only the Jobs owned by this CronJob, with completions, status, duration and age", async () => {
      listJobs.mockResolvedValue({ jobs: [MINE, OTHER] });
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      await waitFor(() => expect(screen.getByText("nightly-backup-28712345")).toBeDefined());
      expect(listJobs).toHaveBeenCalledWith("ctx", "default");
      expect(screen.queryByText("other-job-1")).toBeNull();
      expect(screen.getByText("1/1")).toBeDefined();
      expect(screen.getByText("Complete")).toBeDefined();
      expect(screen.getByText("45s")).toBeDefined();
      expect(screen.getByText("1h")).toBeDefined();
    });

    /**
     * The word AND the tone, both from core's `jobStatus` — the same verdict
     * the Jobs list draws. This component paired them by hand, which is the
     * shape that let the Workloads table drift from the detail header. (#331)
     */
    it.each([
      ["a failed run", { failed: 1 }],
      ["a run in progress", { active: 1 }],
      ["a finished run", {}],
    ])("draws %s with core's own verdict, tone included", async (_label, over) => {
      const job = { ...MINE, ...over };
      listJobs.mockResolvedValue({ jobs: [job] });
      const { status, health } = jobStatus(job.failed ?? 0, job.active ?? 0);
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      await waitFor(() => expect(screen.getByText(status)).toBeDefined());
      expect(screen.getByText(status).closest(".status")?.getAttribute("data-kind")).toBe(health);
    });

    it("shows No jobs yet for a CronJob that has never run", async () => {
      listJobs.mockResolvedValue({ jobs: [] });
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      await waitFor(() => expect(screen.getByText("No jobs yet")).toBeDefined());
    });

    it("renders the Job's name inert, with no navigation control", async () => {
      listJobs.mockResolvedValue({ jobs: [MINE] });
      render(<CronJobDetailsBody object={cronjob({})} context="ctx" />);
      await waitFor(() => expect(screen.getByText("nightly-backup-28712345")).toBeDefined());
      expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
    });
  });

  it("is a run of flat blocks, not a stack of cards", async () => {
    const { container } = render(
      <CronJobDetailsBody object={cronjob({ schedule: "0 2 * * *" })} context="ctx" />,
    );
    await waitFor(() => expect(screen.getByText("No jobs yet")).toBeDefined());
    const blocks = [...container.children];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) expect(block.matches("section.section")).toBe(true);
    expect(container.querySelector(".card")).toBeNull();
  });

  describe("composition with GenericBody", () => {
    it("renders the wrapper's facts and Schedule together with no related-pods section", async () => {
      const cj = cronjob({ schedule: "0 2 * * *" }, {}, { name: "nightly-backup", namespace: "default" });
      render(
        <GenericBody kind="CronJob" object={cj} context="ctx">
          <CronJobDetailsBody object={cj} context="ctx" />
        </GenericBody>,
      );
      await waitFor(() => expect(screen.getByText("No jobs yet")).toBeDefined());
      // The namespace is a fact the SCREEN draws, off the one derivation
      // both screens read; neither wrapper nor body states it again.
      expect(detailFacts({ kind: "CronJob", object: cj }).map((f) => f.label)).toContain("Namespace");
      expect(screen.queryByText("Namespace")).toBeNull();
      expect(screen.getByRole("heading", { name: "Schedule" })).toBeDefined();
      // CronJob has no `relatedPodSelector` case, so GenericBody fetches nothing.
      expect(screen.queryByRole("heading", { name: "Pods" })).toBeNull();
    });
  });
});
