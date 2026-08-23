import { useEffect, useState } from "react";
import {
  ageSortValue,
  asArray,
  asRecord,
  listJobs,
  str,
  timestampWithAge,
  type JobSummary,
  type K8sObject,
} from "@srelens/core";
import { KV, LoadingState, Section, StatusPill, Table, type Column, type StatusKind } from "@srelens/ui-kit";

/** A formatted list, one item per line — matches `PodBody`'s/`WorkloadBody`'s
 *  own helper of the same shape, kept local since it's a small presentational
 *  detail, not a shared formatter. */
function StringList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item, i) => (
        <li key={`${item}-${i}`} className="font-mono text-[0.8125rem]">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * A CronJob's schedule — classic's "Schedule" section, ported fact-for-fact:
 * the cron expression, whether it's suspended, its concurrency policy, when
 * it last ran, how much history it keeps, and its currently-active Jobs.
 * "Active jobs" is a `LinkedResources` list in classic that navigates to
 * each Job; here it renders as inert "Kind/name" text — see the task report
 * for the full inert-value list.
 */
function ScheduleSection({ object }: { object: K8sObject }) {
  const meta = object.metadata ?? {};
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const namespace = str(meta.namespace) || null;
  const lastSchedule = str(status.lastScheduleTime);
  const successKept = str(spec.successfulJobsHistoryLimit) || "3";
  const failedKept = str(spec.failedJobsHistoryLimit) || "1";
  const activeJobs = asArray(status.active)
    .map(asRecord)
    .map((job) => ({
      kind: str(job.kind) || "Job",
      namespace: str(job.namespace) || namespace,
      name: str(job.name),
    }))
    .filter((job) => job.name);

  return (
    <Section title="Schedule">
      <KV k="Schedule" v={str(spec.schedule)} mono />
      <KV k="Suspend" v={spec.suspend === true ? "Yes" : "No"} />
      <KV k="Concurrency policy" v={str(spec.concurrencyPolicy)} />
      <KV k="Last schedule" v={lastSchedule ? timestampWithAge(lastSchedule, Date.now()) : "—"} />
      <KV k="History (kept)" v={`${successKept} succeeded, ${failedKept} failed`} />
      <KV
        k="Active jobs"
        v={
          activeJobs.length > 0 ? (
            <StringList items={activeJobs.map((j) => `${j.kind}/${j.name}`)} />
          ) : (
            "0"
          )
        }
      />
    </Section>
  );
}

/** classic's `CronJobJobs`: whether a spawned Job succeeded, is running, or
 *  failed — not a `phaseKind`-style Pod/workload phase, so kept local rather
 *  than forced onto that formatter. */
function jobStatus(j: JobSummary): { status: string; kind: StatusKind } {
  if (j.failed > 0) return { status: "Failed", kind: "danger" };
  if (j.active > 0) return { status: "Active", kind: "warning" };
  return { status: "Complete", kind: "success" };
}

const RECENT_JOB_COLUMNS: Column<JobSummary>[] = [
  { key: "name", header: "Name", render: (j) => <span className="font-mono">{j.name}</span> },
  { key: "completions", header: "Completions", render: (j) => j.completions },
  {
    key: "status",
    header: "Status",
    render: (j) => {
      const { status, kind } = jobStatus(j);
      return <StatusPill status={status} kind={kind} />;
    },
  },
  { key: "duration", header: "Duration", render: (j) => j.duration || "—" },
  { key: "age", header: "Age", getSortValue: ageSortValue, render: (j) => j.age },
];

/**
 * The Jobs this CronJob has spawned — classic's `CronJobJobs`, fetched live
 * via core's `listJobs` and kept to the ones owned by this CronJob (matching
 * classic's own client-side `j.owner === ownerName` filter; core's
 * `listJobs` has no owner parameter of its own). Classic's row click opens
 * the Job; that's the only thing this component does beyond showing rows —
 * no write action — and it renders here as an inert table, same as
 * `WorkloadBody`'s Deploy Revisions.
 */
function RecentJobsSection({
  context,
  namespace,
  ownerName,
}: {
  context: string;
  namespace: string;
  ownerName: string;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; jobs?: JobSummary[] }>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    listJobs(context, namespace).then((out) => {
      if (!active) return;
      if (out.error) {
        setState({ status: "error" });
        return;
      }
      setState({ status: "ready", jobs: (out.jobs ?? []).filter((j) => j.owner === ownerName) });
    });
    return () => {
      active = false;
    };
  }, [context, namespace, ownerName]);

  if (state.status === "error") return null; // a missing jobs list shouldn't break the panel
  if (state.status === "loading") {
    return (
      <Section title="Recent Jobs">
        <LoadingState label="Loading jobs" />
      </Section>
    );
  }

  return (
    <Section title="Recent Jobs">
      <Table
        columns={RECENT_JOB_COLUMNS}
        data={state.jobs ?? []}
        getRowKey={(j) => j.name}
        emptyText="No jobs yet"
      />
    </Section>
  );
}

/**
 * A CronJob's Details pane: Schedule, then its recent Jobs (classic's
 * `CronJobBody`). `relatedPodSelector` has no case for "CronJob", so
 * `GenericBody` fetches no related pods for one; its Metadata and Conditions
 * sections still wrap this body.
 */
export function CronJobDetailsBody({ object, context }: { object: K8sObject; context: string }) {
  const namespace = str(object.metadata?.namespace);
  const name = str(object.metadata?.name);

  return (
    <>
      <ScheduleSection object={object} />
      {context && namespace && name && (
        <RecentJobsSection context={context} namespace={namespace} ownerName={name} />
      )}
    </>
  );
}
