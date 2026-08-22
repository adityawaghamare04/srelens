import {
  ageSortValue,
  type CronJobSummary,
  type DaemonSetSummary,
  type DeploymentSummary,
  type JobSummary,
  type NodeSummary,
  type PodSummary,
  type StatefulSetSummary,
} from "@srelens/core";
import { Badge, StatusPill, type Column, type StatusKind, type Tone } from "@srelens/ui-kit";

export type PodRow = PodSummary & { cpu?: number; memory?: number };
export type NodeRow = NodeSummary & { cpu?: number; memory?: number };

/**
 * A reading metrics-server did not give us is not zero: an em dash says so, and
 * `-1` sorts it below every real reading rather than into the middle of the
 * idle pods.
 */
const metric = (value: number | undefined, unit: string) => (value == null ? "—" : `${value}${unit}`);
const metricSort = (value: number | undefined) => value ?? -1;

/** Classic's phase-to-tone mapping (`ResourceBrowser.tsx:135`), ported verbatim
 *  onto the kit's `StatusKind` vocabulary — the names already match one-for-one. */
function phaseKind(phase: string): StatusKind {
  switch (phase) {
    case "Running":
    case "Succeeded":
    case "Ready":
      return "success";
    case "Pending":
      return "warning";
    case "Failed":
    case "Unknown":
    case "NotReady":
      return "danger";
    default:
      return "neutral";
  }
}

export const podColumns: Column<PodRow>[] = [
  { key: "name", header: "Pod", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "ready", header: "Ready" },
  {
    key: "phase", header: "Status", sortable: true, filterable: true,
    render: (p) => <StatusPill status={p.phase} kind={phaseKind(p.phase)} />,
  },
  { key: "restarts", header: "Restarts", sortable: true },
  { key: "cpu", header: "CPU", sortable: true, render: (p) => metric(p.cpu, "m"), getSortValue: (p) => metricSort(p.cpu) },
  { key: "memory", header: "Memory", sortable: true, render: (p) => metric(p.memory, "Mi"), getSortValue: (p) => metricSort(p.memory) },
  { key: "node", header: "Node", sortable: true, filterable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const deploymentColumns: Column<DeploymentSummary>[] = [
  { key: "name", header: "Deployment", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "ready", header: "Ready" },
  { key: "upToDate", header: "Up-to-date", sortable: true },
  { key: "available", header: "Available", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const statefulSetColumns: Column<StatefulSetSummary>[] = [
  { key: "name", header: "StatefulSet", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "ready", header: "Ready" },
  { key: "updated", header: "Updated", sortable: true },
  { key: "service", header: "Service", sortable: true, filterable: true, render: (s) => s.service || "—" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const daemonSetColumns: Column<DaemonSetSummary>[] = [
  { key: "name", header: "DaemonSet", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "desired", header: "Desired", sortable: true },
  { key: "current", header: "Current", sortable: true },
  { key: "ready", header: "Ready", sortable: true },
  { key: "upToDate", header: "Up-to-date", sortable: true },
  { key: "available", header: "Available", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const jobColumns: Column<JobSummary>[] = [
  { key: "name", header: "Job", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "completions", header: "Completions" },
  {
    key: "status",
    header: "Status",
    render: (j) => {
      const [status, kind]: [string, StatusKind] =
        j.failed > 0 ? ["Failed", "danger"] : j.active > 0 ? ["Active", "warning"] : ["Complete", "success"];
      return <StatusPill status={status} kind={kind} />;
    },
  },
  { key: "duration", header: "Duration", render: (j) => j.duration || "—" },
  { key: "owner", header: "Owner", render: (j) => j.owner || "—" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const cronJobColumns: Column<CronJobSummary>[] = [
  { key: "name", header: "CronJob", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "schedule", header: "Schedule" },
  {
    key: "suspended",
    header: "State",
    render: (c) =>
      c.suspended ? <StatusPill status="Suspended" kind="neutral" /> : <StatusPill status="Active" kind="success" />,
  },
  { key: "active", header: "Active" },
  { key: "lastSchedule", header: "Last run", render: (c) => c.lastSchedule || "—" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

/** "warning" / "neutral" classic badge variants, remapped onto the kit's `Tone`. */
const BADGE_TONE: Record<string, Tone> = { warning: "warn", neutral: "muted" };

export const nodeColumns: Column<NodeRow>[] = [
  { key: "name", header: "Node", sortable: true, filterable: true },
  {
    key: "status",
    header: "Status",
    sortable: true,
    filterable: true,
    render: (n) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <StatusPill status={n.status} kind={phaseKind(n.status)} />
        {n.unschedulable && <Badge tone={BADGE_TONE.warning}>SchedulingDisabled</Badge>}
        {n.taints > 0 && (
          <Badge tone={BADGE_TONE.neutral}>{n.taints > 1 ? `Tainted (${n.taints})` : "Tainted"}</Badge>
        )}
      </span>
    ),
  },
  { key: "roles", header: "Roles" },
  { key: "cpu", header: "CPU", sortable: true, render: (n) => metric(n.cpu, "m"), getSortValue: (n) => metricSort(n.cpu) },
  { key: "memory", header: "Memory", sortable: true, render: (n) => metric(n.memory, "Mi"), getSortValue: (n) => metricSort(n.memory) },
  { key: "version", header: "Version" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];
