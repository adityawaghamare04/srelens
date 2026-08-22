import {
  ageSortValue,
  formatStorageSize,
  type ClusterRoleBindingSummary,
  type ClusterRoleSummary,
  type ConfigMapSummary,
  type CronJobSummary,
  type DaemonSetSummary,
  type DeploymentSummary,
  type EndpointSliceSummary,
  type IngressSummary,
  type JobSummary,
  type LimitRangeSummary,
  type NetworkPolicySummary,
  type NodeSummary,
  type PodSummary,
  type PvSummary,
  type PvcSummary,
  type ResourceQuotaSummary,
  type RoleBindingSummary,
  type RoleSummary,
  type SecretSummary,
  type ServiceAccountSummary,
  type ServiceSummary,
  type StatefulSetSummary,
  type StorageClassSummary,
} from "@srelens/core";
import { Badge, StatusPill, type Column, type StatusKind, type Tone } from "@srelens/ui-kit";

export type PodRow = PodSummary & { cpu?: number; memory?: number };
export type NodeRow = NodeSummary & { cpu?: number; memory?: number };

/** A thin space (U+2009), not a locale comma — the design's CPU thousands separator. */
const THIN_SPACE = " ";

/**
 * CPU in millicores: a bare number under 1000 ("241m"), thousands-grouped
 * with a thin space at or above it ("2 410m") — the design's own grouping,
 * distinct from a locale-formatted comma and readable at four digits, where a
 * bare run of digits is not.
 */
export function formatCpu(value: number): string {
  const rounded = Math.round(value);
  const digits = Math.abs(rounded).toString();
  const grouped =
    digits.length > 3 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE) : digits;
  return `${rounded < 0 ? "-" : ""}${grouped}m`;
}

/**
 * Memory in Mi: a bare number under 1024 Mi ("412 Mi"), scaled to Gi with one
 * decimal place at or above it ("3.1 Gi") — the design shows both, and a
 * space before the unit either way (classic ran the two together: "988Mi").
 */
export function formatMemory(value: number): string {
  if (value >= 1024) return `${(value / 1024).toFixed(1)} Gi`;
  return `${value} Mi`;
}

/**
 * A reading metrics-server did not give us is not zero: an em dash says so,
 * and `-1` sorts it below every real reading rather than into the middle of
 * the idle pods. `getSortValue` reads this straight — never the string
 * `format` renders — so the raw Mi value orders "3.1 Gi" correctly against
 * "988 Mi", which a comparator pointed at the display text could not.
 */
const metric = (value: number | undefined, format: (value: number) => string) =>
  value == null ? "—" : format(value);
const metricSort = (value: number | undefined) => value ?? -1;

/**
 * Classic's phase-to-tone mapping (`ResourceBrowser.tsx:135`), ported verbatim
 * onto the kit's `StatusKind` vocabulary — the names already match one-for-one.
 *
 * Exported rather than kept private: `Workloads.tsx` needs the same mapping
 * for a Pod's `phase` (its `Ready`/`NotReady` cases just never come up there,
 * since a Pod never reports either).
 */
export function phaseKind(phase: string): StatusKind {
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

/** The design's unhealthy dot for a pod: derived from `phaseKind` above, not
 *  restated here — a phase `phaseKind` calls healthy (e.g. `Succeeded`, which
 *  renders a green pill) must never also earn a "needs attention" dot. The
 *  next phase added to the success set only needs editing in one place. */
export const podFlagged = (row: PodRow): boolean => phaseKind(row.phase) !== "success";

export const podColumns: Column<PodRow>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "ready", header: "Ready", align: "end" },
  {
    key: "phase", header: "Status", sortable: true,
    render: (p) => <StatusPill status={p.phase} kind={phaseKind(p.phase)} />,
  },
  { key: "restarts", header: "Restarts", sortable: true, align: "end" },
  { key: "cpu", header: "CPU", sortable: true, align: "end", render: (p) => metric(p.cpu, formatCpu), getSortValue: (p) => metricSort(p.cpu) },
  { key: "memory", header: "Memory", sortable: true, align: "end", render: (p) => metric(p.memory, formatMemory), getSortValue: (p) => metricSort(p.memory) },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
  // Not sortable: a comma-joined list of container images (PodSummary.image)
  // has no single natural order, and the design mock renders a plain header
  // for it — no SortHeader. Left filterable-unset like every other column
  // here, so it still joins the toolbar's whole-row search.
  { key: "image", header: "Image", sortable: false, render: (p) => p.image || "—" },
];

/** "N/M" is short of desired when N < M — how Deployment and StatefulSet
 *  both report readiness. */
function readyShort(ready: string): boolean {
  const [have, want] = ready.split("/").map(Number);
  return Number.isFinite(have) && Number.isFinite(want) && have < want;
}

/** The design's unhealthy dot for a Deployment: fewer ready than desired. */
export const deploymentFlagged = (row: DeploymentSummary): boolean => readyShort(row.ready);

export const deploymentColumns: Column<DeploymentSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "ready", header: "Ready", align: "end" },
  { key: "upToDate", header: "Up-to-date", sortable: true, align: "end" },
  { key: "available", header: "Available", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

/** The design's unhealthy dot for a StatefulSet: fewer ready than desired. */
export const statefulSetFlagged = (row: StatefulSetSummary): boolean => readyShort(row.ready);

export const statefulSetColumns: Column<StatefulSetSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "ready", header: "Ready", align: "end" },
  { key: "updated", header: "Updated", sortable: true, align: "end" },
  { key: "service", header: "Service", sortable: true, render: (s) => s.service || "—" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

/** The design's unhealthy dot for a DaemonSet: fewer ready than desired —
 *  numeric fields here, unlike Deployment/StatefulSet's "N/M" string. */
export const daemonSetFlagged = (row: DaemonSetSummary): boolean => row.ready < row.desired;

export const daemonSetColumns: Column<DaemonSetSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "desired", header: "Desired", sortable: true, align: "end" },
  { key: "current", header: "Current", sortable: true, align: "end" },
  { key: "ready", header: "Ready", sortable: true, align: "end" },
  { key: "upToDate", header: "Up-to-date", sortable: true, align: "end" },
  { key: "available", header: "Available", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

/** The design's unhealthy dot for a Job: any failed pod. Unambiguous — the
 *  same `failed` count already drives the Status column's red pill below. */
export const jobFlagged = (row: JobSummary): boolean => row.failed > 0;

export const jobColumns: Column<JobSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "completions", header: "Completions", align: "end" },
  {
    key: "status",
    header: "Status",
    render: (j) => {
      const [status, kind]: [string, StatusKind] =
        j.failed > 0 ? ["Failed", "danger"] : j.active > 0 ? ["Active", "warning"] : ["Complete", "success"];
      return <StatusPill status={status} kind={kind} />;
    },
  },
  { key: "duration", header: "Duration", align: "end", render: (j) => j.duration || "—" },
  { key: "owner", header: "Owner", render: (j) => j.owner || "—" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const cronJobColumns: Column<CronJobSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "schedule", header: "Schedule" },
  {
    key: "suspended",
    header: "State",
    render: (c) =>
      c.suspended ? <StatusPill status="Suspended" kind="neutral" /> : <StatusPill status="Active" kind="success" />,
  },
  { key: "active", header: "Active", align: "end" },
  { key: "lastSchedule", header: "Last run", render: (c) => c.lastSchedule || "—" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

/** "warning" / "neutral" classic badge variants, remapped onto the kit's `Tone`. */
const BADGE_TONE: Record<string, Tone> = { warning: "warn", neutral: "muted" };

export const nodeColumns: Column<NodeRow>[] = [
  { key: "name", header: "Name", sortable: true },
  {
    key: "status",
    header: "Status",
    sortable: true,
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
  { key: "cpu", header: "CPU", sortable: true, align: "end", render: (n) => metric(n.cpu, formatCpu), getSortValue: (n) => metricSort(n.cpu) },
  { key: "memory", header: "Memory", sortable: true, align: "end", render: (n) => metric(n.memory, formatMemory), getSortValue: (n) => metricSort(n.memory) },
  { key: "version", header: "Version" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const configMapColumns: Column<ConfigMapSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "keys", header: "Keys", sortable: true, align: "end", render: (c) => String(c.keys) },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const secretColumns: Column<SecretSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "type", header: "Type" },
  { key: "keys", header: "Keys", sortable: true, align: "end", render: (s) => String(s.keys) },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const resourceQuotaColumns: Column<ResourceQuotaSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "resources", header: "Resources", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const limitRangeColumns: Column<LimitRangeSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "limits", header: "Limits", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const serviceColumns: Column<ServiceSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "type", header: "Type" },
  { key: "clusterIP", header: "Cluster IP" },
  { key: "externalIP", header: "External IP", render: (s) => s.externalIP || "—" },
  { key: "ports", header: "Ports" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const ingressColumns: Column<IngressSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "class", header: "Class" },
  { key: "hosts", header: "Hosts", render: (i) => i.hosts || "*" },
  { key: "address", header: "Address", render: (i) => i.address || "—" },
  { key: "ports", header: "Ports" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const endpointSliceColumns: Column<EndpointSliceSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "addressType", header: "Address Type" },
  { key: "endpoints", header: "Endpoints", align: "end" },
  { key: "ports", header: "Ports", render: (e) => e.ports || "—" },
  { key: "service", header: "Service", render: (e) => e.service || "—" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const networkPolicyColumns: Column<NetworkPolicySummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "podSelector", header: "Pod Selector" },
  { key: "ingress", header: "Ingress", sortable: true, align: "end" },
  { key: "egress", header: "Egress", sortable: true, align: "end" },
  { key: "policyTypes", header: "Policy Types", render: (n) => n.policyTypes || "—" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const pvcColumns: Column<PvcSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  {
    key: "status", header: "Status", sortable: true,
    render: (p) => <StatusPill status={p.status} kind={phaseKind(p.status === "Bound" ? "Ready" : p.status)} />,
  },
  { key: "capacity", header: "Capacity", align: "end", render: (p) => formatStorageSize(p.capacity) },
  { key: "accessModes", header: "Access Modes", render: (p) => p.accessModes || "—" },
  { key: "storageClass", header: "Storage Class", render: (p) => p.storageClass || "—" },
  { key: "volume", header: "Volume", render: (p) => p.volume || "—" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const pvColumns: Column<PvSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "capacity", header: "Capacity", align: "end", render: (p) => formatStorageSize(p.capacity) },
  { key: "accessModes", header: "Access Modes", render: (p) => p.accessModes || "—" },
  { key: "reclaimPolicy", header: "Reclaim", render: (p) => p.reclaimPolicy || "—" },
  {
    key: "status", header: "Status", sortable: true,
    render: (p) => (
      <StatusPill status={p.status} kind={phaseKind(p.status === "Bound" || p.status === "Available" ? "Ready" : p.status)} />
    ),
  },
  { key: "claim", header: "Claim", render: (p) => p.claim || "—" },
  { key: "storageClass", header: "Storage Class", render: (p) => p.storageClass || "—" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const storageClassColumns: Column<StorageClassSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "provisioner", header: "Provisioner" },
  { key: "reclaimPolicy", header: "Reclaim", render: (s) => s.reclaimPolicy || "—" },
  { key: "volumeBindingMode", header: "Binding Mode", render: (s) => s.volumeBindingMode || "—" },
  { key: "default", header: "Default", render: (s) => (s.default ? <StatusPill status="Default" kind="success" /> : "—") },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const serviceAccountColumns: Column<ServiceAccountSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "secrets", header: "Secrets", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const roleColumns: Column<RoleSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "rules", header: "Rules", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const clusterRoleColumns: Column<ClusterRoleSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "rules", header: "Rules", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const roleBindingColumns: Column<RoleBindingSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "namespace", header: "Namespace", sortable: true },
  { key: "role", header: "Role" },
  { key: "subjects", header: "Subjects", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];

export const clusterRoleBindingColumns: Column<ClusterRoleBindingSummary>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "role", header: "Role" },
  { key: "subjects", header: "Subjects", sortable: true, align: "end" },
  { key: "age", header: "Age", sortable: true, align: "end", getSortValue: ageSortValue },
];
