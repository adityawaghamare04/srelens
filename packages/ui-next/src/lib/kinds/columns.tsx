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

export const configMapColumns: Column<ConfigMapSummary>[] = [
  { key: "name", header: "ConfigMap", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "keys", header: "Keys", sortable: true, render: (c) => String(c.keys) },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const secretColumns: Column<SecretSummary>[] = [
  { key: "name", header: "Secret", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "type", header: "Type", filterable: true },
  { key: "keys", header: "Keys", sortable: true, render: (s) => String(s.keys) },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const resourceQuotaColumns: Column<ResourceQuotaSummary>[] = [
  { key: "name", header: "Resource Quota", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "resources", header: "Resources", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const limitRangeColumns: Column<LimitRangeSummary>[] = [
  { key: "name", header: "Limit Range", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "limits", header: "Limits", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const serviceColumns: Column<ServiceSummary>[] = [
  { key: "name", header: "Service", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "type", header: "Type", filterable: true },
  { key: "clusterIP", header: "Cluster IP" },
  { key: "externalIP", header: "External IP", render: (s) => s.externalIP || "—" },
  { key: "ports", header: "Ports" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const ingressColumns: Column<IngressSummary>[] = [
  { key: "name", header: "Ingress", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "class", header: "Class", filterable: true },
  { key: "hosts", header: "Hosts", render: (i) => i.hosts || "*" },
  { key: "address", header: "Address", render: (i) => i.address || "—" },
  { key: "ports", header: "Ports" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const endpointSliceColumns: Column<EndpointSliceSummary>[] = [
  { key: "name", header: "Endpoint Slice", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "addressType", header: "Address Type" },
  { key: "endpoints", header: "Endpoints" },
  { key: "ports", header: "Ports", render: (e) => e.ports || "—" },
  { key: "service", header: "Service", render: (e) => e.service || "—" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const networkPolicyColumns: Column<NetworkPolicySummary>[] = [
  { key: "name", header: "Network Policy", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "podSelector", header: "Pod Selector" },
  { key: "ingress", header: "Ingress", sortable: true },
  { key: "egress", header: "Egress", sortable: true },
  { key: "policyTypes", header: "Policy Types", render: (n) => n.policyTypes || "—" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const pvcColumns: Column<PvcSummary>[] = [
  { key: "name", header: "Claim", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  {
    key: "status", header: "Status", sortable: true, filterable: true,
    render: (p) => <StatusPill status={p.status} kind={phaseKind(p.status === "Bound" ? "Ready" : p.status)} />,
  },
  { key: "capacity", header: "Capacity", render: (p) => formatStorageSize(p.capacity) },
  { key: "accessModes", header: "Access Modes", render: (p) => p.accessModes || "—" },
  { key: "storageClass", header: "Storage Class", filterable: true, render: (p) => p.storageClass || "—" },
  { key: "volume", header: "Volume", render: (p) => p.volume || "—" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const pvColumns: Column<PvSummary>[] = [
  { key: "name", header: "Volume", sortable: true, filterable: true },
  { key: "capacity", header: "Capacity", render: (p) => formatStorageSize(p.capacity) },
  { key: "accessModes", header: "Access Modes", render: (p) => p.accessModes || "—" },
  { key: "reclaimPolicy", header: "Reclaim", render: (p) => p.reclaimPolicy || "—" },
  {
    key: "status", header: "Status", sortable: true, filterable: true,
    render: (p) => (
      <StatusPill status={p.status} kind={phaseKind(p.status === "Bound" || p.status === "Available" ? "Ready" : p.status)} />
    ),
  },
  { key: "claim", header: "Claim", render: (p) => p.claim || "—" },
  { key: "storageClass", header: "Storage Class", filterable: true, render: (p) => p.storageClass || "—" },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const storageClassColumns: Column<StorageClassSummary>[] = [
  { key: "name", header: "Storage Class", sortable: true, filterable: true },
  { key: "provisioner", header: "Provisioner", filterable: true },
  { key: "reclaimPolicy", header: "Reclaim", render: (s) => s.reclaimPolicy || "—" },
  { key: "volumeBindingMode", header: "Binding Mode", render: (s) => s.volumeBindingMode || "—" },
  { key: "default", header: "Default", render: (s) => (s.default ? <StatusPill status="Default" kind="success" /> : "—") },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const serviceAccountColumns: Column<ServiceAccountSummary>[] = [
  { key: "name", header: "Service Account", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "secrets", header: "Secrets", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const roleColumns: Column<RoleSummary>[] = [
  { key: "name", header: "Role", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "rules", header: "Rules", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const clusterRoleColumns: Column<ClusterRoleSummary>[] = [
  { key: "name", header: "Cluster Role", sortable: true, filterable: true },
  { key: "rules", header: "Rules", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const roleBindingColumns: Column<RoleBindingSummary>[] = [
  { key: "name", header: "Role Binding", sortable: true, filterable: true },
  { key: "namespace", header: "Namespace", sortable: true, filterable: true },
  { key: "role", header: "Role", filterable: true },
  { key: "subjects", header: "Subjects", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];

export const clusterRoleBindingColumns: Column<ClusterRoleBindingSummary>[] = [
  { key: "name", header: "Cluster Role Binding", sortable: true, filterable: true },
  { key: "role", header: "Role", filterable: true },
  { key: "subjects", header: "Subjects", sortable: true },
  { key: "age", header: "Age", sortable: true, getSortValue: ageSortValue },
];
