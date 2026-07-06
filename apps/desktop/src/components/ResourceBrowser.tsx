import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  listNamespaces,
  podMetrics,
  type PodSummary,
  type DeploymentSummary,
  type ServiceSummary,
} from "../lib/workloads";
import {
  listNodes,
  listResource,
  nodeMetrics,
  type NodeSummary,
  type ResourceRow,
  type EventSummary,
} from "../lib/manifest";

type NodeRow = NodeSummary & { cpu?: number; memory?: number };
type PodRow = PodSummary & { cpu?: number; memory?: number };
import { watchResource, WATCHABLE_KINDS, type WatchHandle, type WatchStatus } from "../lib/watch";
import { PodActions, ResourceActions, ServiceForwardAction } from "./DetailActions";
import { NodeCordonAction } from "./NodeCordonAction";
import { ResourceDetail } from "./ResourceDetail";
import type { OpenResource } from "../lib/resourceNavigation";
import {
  Table,
  filterTableData,
  Combobox,
  Spinner,
  Badge,
  Button,
  Drawer,
  StatusPill,
  TextInput,
  Toolbar,
  type Column,
  type StatusKind,
} from "../ui";

export type ResourceKind =
  | "overview"
  | "pods"
  | "deployments"
  | "statefulsets"
  | "daemonsets"
  | "replicasets"
  | "jobs"
  | "cronjobs"
  | "configmaps"
  | "secrets"
  | "resourcequotas"
  | "limitranges"
  | "horizontalpodautoscalers"
  | "poddisruptionbudgets"
  | "priorityclasses"
  | "runtimeclasses"
  | "leases"
  | "mutatingwebhookconfigurations"
  | "validatingwebhookconfigurations"
  | "serviceaccounts"
  | "clusterroles"
  | "roles"
  | "clusterrolebindings"
  | "rolebindings"
  | "services"
  | "endpoints"
  | "endpointslices"
  | "ingresses"
  | "ingressclasses"
  | "networkpolicies"
  | "persistentvolumeclaims"
  | "persistentvolumes"
  | "storageclasses"
  | "namespaces"
  | "events"
  | "nodes"
  | "portforwards"
  | "helmreleases"
  | "settings"
  | "newresource";

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  overview: "Overview",
  pods: "Pods",
  deployments: "Deployments",
  statefulsets: "StatefulSets",
  daemonsets: "DaemonSets",
  replicasets: "ReplicaSets",
  jobs: "Jobs",
  cronjobs: "CronJobs",
  configmaps: "ConfigMaps",
  secrets: "Secrets",
  resourcequotas: "Resource Quotas",
  limitranges: "Limit Ranges",
  horizontalpodautoscalers: "Horizontal Pod Autoscalers",
  poddisruptionbudgets: "Pod Disruption Budgets",
  priorityclasses: "Priority Classes",
  runtimeclasses: "Runtime Classes",
  leases: "Leases",
  mutatingwebhookconfigurations: "Mutating Webhook Configs",
  validatingwebhookconfigurations: "Validating Webhook Configs",
  serviceaccounts: "Service Accounts",
  clusterroles: "Cluster Roles",
  roles: "Roles",
  clusterrolebindings: "Cluster Role Bindings",
  rolebindings: "Role Bindings",
  services: "Services",
  endpoints: "Endpoints",
  endpointslices: "Endpoint Slices",
  ingresses: "Ingresses",
  ingressclasses: "Ingress Classes",
  networkpolicies: "Network Policies",
  persistentvolumeclaims: "Persistent Volume Claims",
  persistentvolumes: "Persistent Volumes",
  storageclasses: "Storage Classes",
  namespaces: "Namespaces",
  events: "Events",
  nodes: "Nodes",
  portforwards: "Port Forwards",
  helmreleases: "Helm Releases",
  settings: "Settings",
  newresource: "New Resource",
};

export const K8S_KIND: Record<ResourceKind, string> = {
  overview: "",
  pods: "Pod",
  deployments: "Deployment",
  statefulsets: "StatefulSet",
  daemonsets: "DaemonSet",
  replicasets: "ReplicaSet",
  jobs: "Job",
  cronjobs: "CronJob",
  configmaps: "ConfigMap",
  secrets: "Secret",
  resourcequotas: "ResourceQuota",
  limitranges: "LimitRange",
  horizontalpodautoscalers: "HorizontalPodAutoscaler",
  poddisruptionbudgets: "PodDisruptionBudget",
  priorityclasses: "PriorityClass",
  runtimeclasses: "RuntimeClass",
  leases: "Lease",
  mutatingwebhookconfigurations: "MutatingWebhookConfiguration",
  validatingwebhookconfigurations: "ValidatingWebhookConfiguration",
  serviceaccounts: "ServiceAccount",
  clusterroles: "ClusterRole",
  roles: "Role",
  clusterrolebindings: "ClusterRoleBinding",
  rolebindings: "RoleBinding",
  services: "Service",
  endpoints: "Endpoints",
  endpointslices: "EndpointSlice",
  ingresses: "Ingress",
  ingressclasses: "IngressClass",
  networkpolicies: "NetworkPolicy",
  persistentvolumeclaims: "PersistentVolumeClaim",
  persistentvolumes: "PersistentVolume",
  storageclasses: "StorageClass",
  namespaces: "Namespace",
  events: "Event",
  nodes: "Node",
  portforwards: "",
  helmreleases: "",
  settings: "",
  newresource: "",
};

const CLUSTER_SCOPED: ResourceKind[] = [
  "nodes",
  "namespaces",
  "persistentvolumes",
  "storageclasses",
  "priorityclasses",
  "runtimeclasses",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  "ingressclasses",
  "clusterroles",
  "clusterrolebindings",
];
// Typed views with bespoke columns; everything else namespaced uses the generic table.
const TYPED_KINDS: ResourceKind[] = [
  "pods",
  "deployments",
  "services",
  "nodes",
  "events",
];
const isGeneric = (kind: ResourceKind) => !TYPED_KINDS.includes(kind);
const isNamespaced = (kind: ResourceKind) => !CLUSTER_SCOPED.includes(kind);
const isWatchable = (kind: ResourceKind) => (WATCHABLE_KINDS as readonly string[]).includes(kind);
const POLL_MS = 5000;

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

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}

const podColumns: Column<PodRow>[] = [
  { key: "name", header: "Pod", render: (p) => <Muted>{p.name}</Muted> },
  { key: "namespace", header: "Namespace", render: (p) => <span className="fl-link">{p.namespace}</span> },
  { key: "cpu", header: "CPU", render: (p) => <Muted>{p.cpu != null ? `${p.cpu}m` : "—"}</Muted> },
  { key: "memory", header: "Memory", render: (p) => <Muted>{p.memory != null ? `${p.memory}Mi` : "—"}</Muted> },
  { key: "ready", header: "Ready" },
  { key: "phase", header: "Phase", render: (p) => <StatusPill status={p.phase} kind={phaseKind(p.phase)} /> },
  { key: "restarts", header: "Restarts" },
  { key: "node", header: "Node", render: (p) => <Muted>{p.node}</Muted> },
  { key: "age", header: "Age", render: (p) => <Muted>{p.age}</Muted> },
];

const deploymentColumns: Column<DeploymentSummary>[] = [
  { key: "name", header: "Deployment", render: (d) => <strong>{d.name}</strong> },
  { key: "namespace", header: "Namespace", render: (d) => <span className="fl-link">{d.namespace}</span> },
  { key: "ready", header: "Ready" },
  { key: "upToDate", header: "Up-to-date" },
  { key: "available", header: "Available" },
  { key: "age", header: "Age", render: (d) => <Muted>{d.age}</Muted> },
];

const serviceColumns: Column<ServiceSummary>[] = [
  { key: "name", header: "Service", render: (s) => <strong>{s.name}</strong> },
  { key: "namespace", header: "Namespace", render: (s) => <span className="fl-link">{s.namespace}</span> },
  { key: "type", header: "Type" },
  { key: "clusterIP", header: "Cluster IP", render: (s) => <Muted>{s.clusterIP}</Muted> },
  { key: "ports", header: "Ports" },
  { key: "age", header: "Age", render: (s) => <Muted>{s.age}</Muted> },
];

const nodeColumns: Column<NodeRow>[] = [
  { key: "name", header: "Node", render: (n) => <strong>{n.name}</strong> },
  { key: "status", header: "Status", render: (n) => <StatusPill status={n.status} kind={phaseKind(n.status)} /> },
  { key: "roles", header: "Roles" },
  { key: "cpu", header: "CPU", render: (n) => <Muted>{n.cpu != null ? `${n.cpu}m` : "—"}</Muted> },
  { key: "memory", header: "Memory", render: (n) => <Muted>{n.memory != null ? `${n.memory}Mi` : "—"}</Muted> },
  { key: "version", header: "Version", render: (n) => <Muted>{n.version}</Muted> },
  { key: "age", header: "Age", render: (n) => <Muted>{n.age}</Muted> },
];

const genericColumns: Column<ResourceRow>[] = [
  { key: "name", header: "Name", render: (r) => <strong>{r.name}</strong> },
  { key: "namespace", header: "Namespace", render: (r) => <span className="fl-link">{r.namespace}</span> },
  { key: "age", header: "Age", render: (r) => <Muted>{r.age}</Muted> },
];

const eventColumns: Column<EventSummary & { name: string }>[] = [
  {
    key: "type",
    header: "Type",
    render: (e) => <StatusPill status={e.type} kind={e.type === "Warning" ? "danger" : "info"} />,
  },
  { key: "reason", header: "Reason", render: (e) => <strong>{e.reason}</strong> },
  { key: "object", header: "Object", render: (e) => <span className="fl-link">{e.object}</span> },
  { key: "message", header: "Message" },
  { key: "age", header: "Age", render: (e) => <Muted>{e.age}</Muted> },
];

interface ResourceState {
  rows: Array<{ name: string }>;
  error: string;
  loading: boolean;
}

interface OtherDetail {
  kind: string;
  namespace: string | null;
  name: string;
}

export function ResourceBrowser({
  context,
  kind,
  query = "",
  onQueryChange,
  onOpenTerminal,
  onOpenLogs,
  onOpenWorkloadLogs,
  onOpenNew,
  onOpenResource,
  focus,
  initialNamespace = "",
  onNamespaceChange,
  detailDrawerWidth = 480,
}: {
  context: string;
  kind: ResourceKind;
  query?: string;
  onQueryChange?: (q: string) => void;
  onOpenTerminal?: (s: { context: string; namespace: string; pod: string }) => void;
  onOpenLogs?: (s: { context: string; namespace: string; pod: string }) => void;
  onOpenWorkloadLogs?: (s: { context: string; namespace: string; kind: string; name: string }) => void;
  /** Open a "new resource" editor tab, optionally seeded with this kind's template. */
  onOpenNew?: (initialKind?: string) => void;
  onOpenResource?: OpenResource;
  /** Deep-link target (from global search): open this resource's detail once it loads. */
  focus?: { name: string; namespace: string | null; nonce: number };
  /** Namespace to start on (empty = all); persisted per tab/cluster by the parent. */
  initialNamespace?: string;
  /** Notified when the namespace filter changes, so the parent can preserve it. */
  onNamespaceChange?: (namespace: string) => void;
  detailDrawerWidth?: number;
}) {
  const [namespaces, setNamespaces] = useState<string[] | null>(null);
  const [nsError, setNsError] = useState("");
  const [namespace, setNamespace] = useState(initialNamespace);
  const changeNamespace = (ns: string) => {
    setNamespace(ns);
    onNamespaceChange?.(ns);
  };
  const [res, setRes] = useState<ResourceState>({ rows: [], error: "", loading: false });
  const [watchStatus, setWatchStatus] = useState<WatchStatus>("live");
  const [selectedPod, setSelectedPod] = useState<PodSummary | null>(null);
  const [otherDetail, setOtherDetail] = useState<OtherDetail | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filterColumn, setFilterColumn] = useState<string | null>(null);
  // Per-pod CPU/memory (millicores / MiB), merged into the pods table.
  const [podCpuMem, setPodCpuMem] = useState<Map<string, { cpu: number; mem: number }>>(new Map());
  const viewKeyRef = useRef("");

  const namespaced = isNamespaced(kind);

  useEffect(() => setFilterColumn(null), [kind]);

  useEffect(() => {
    let active = true;
    setNamespaces(null);
    setNsError("");
    void listNamespaces(context).then((outcome) => {
      if (!active) return;
      if (outcome.error) setNsError(outcome.error);
      else setNamespaces(outcome.namespaces ?? []);
      // namespace stays "" = All namespaces by default
    });
    return () => {
      active = false;
    };
  }, [context]);

  useEffect(() => {
    if (namespaced && namespaces === null) return; // wait for the namespace list
    let cancelled = false;
    // Only reset the table for a genuinely new view; a poll keeps current rows.
    const viewKey = `${context}|${namespace}|${kind}`;
    const fresh = viewKeyRef.current !== viewKey;
    viewKeyRef.current = viewKey;
    if (fresh) {
      setSelectedPod(null);
      setOtherDetail(null);
      setRes({ rows: [], error: "", loading: true });
    } else {
      setRes((r) => ({ ...r, loading: true }));
    }

    if (isWatchable(kind)) {
      if (fresh) setWatchStatus("live");
      let handle: WatchHandle | null = null;
      void watchResource(
        context,
        namespace,
        kind,
        (rows) => {
          if (!cancelled) setRes({ rows, error: "", loading: false });
        },
        (status) => {
          if (!cancelled) setWatchStatus(status);
        },
      )
        .then((h) => (cancelled ? h.stop() : (handle = h)))
        .catch((e) => {
          if (!cancelled) setRes({ rows: [], error: String(e), loading: false });
        });
      return () => {
        cancelled = true;
        handle?.stop();
      };
    }

    // Non-watchable kinds (nodes, generic) load on demand + poll. (Events now
    // stream via watch.)
    const loader: Promise<{ rows?: Array<{ name: string }>; error?: string }> =
      kind === "nodes"
        ? Promise.all([listNodes(context), nodeMetrics(context)]).then(([n, m]) => {
            const mm = new Map((m.metrics ?? []).map((x) => [x.name, x]));
            const rows: NodeRow[] = (n.nodes ?? []).map((nd) => ({
              ...nd,
              cpu: mm.get(nd.name)?.cpuMillicores,
              memory: mm.get(nd.name)?.memoryMiB,
            }));
            return { rows, error: n.error }; // metrics are best-effort
          })
        : listResource(context, K8S_KIND[kind], namespace).then((o) => ({
            rows: o.items,
            error: o.error,
          }));
    void loader.then(({ rows, error }) => {
      if (!cancelled) setRes({ rows: rows ?? [], error: error ?? "", loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [context, namespace, kind, namespaced, namespaces, reloadKey]);

  // Poll non-watchable kinds for a live-updating feel (true watch streams
  // cover pods/deployments/services).
  useEffect(() => {
    if (isWatchable(kind)) return;
    if (namespaced && namespaces === null) return;
    const t = setInterval(() => setReloadKey((k) => k + 1), POLL_MS);
    return () => clearInterval(t);
  }, [kind, namespace, namespaced, namespaces, context]);

  // Pods stream over watch (no metrics) — poll pod CPU/memory separately and
  // merge by name. Best-effort: a missing metrics-server just leaves "—".
  useEffect(() => {
    if (kind !== "pods") {
      setPodCpuMem(new Map());
      return;
    }
    let active = true;
    const fetchMetrics = () =>
      void podMetrics(context, namespace).then((o) => {
        if (!active) return;
        setPodCpuMem(
          new Map((o.metrics ?? []).map((m) => [m.name, { cpu: m.cpuMillicores, mem: m.memoryMiB }])),
        );
      });
    fetchMetrics();
    const t = setInterval(fetchMetrics, 10000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [kind, context, namespace]);

  const columns = useMemo(() => {
    if (kind === "events") return eventColumns as unknown as Column<{ name: string }>[];
    if (isGeneric(kind)) return genericColumns as Column<{ name: string }>[];
    switch (kind) {
      case "pods":
        return podColumns as Column<{ name: string }>[];
      case "deployments":
        return deploymentColumns as Column<{ name: string }>[];
      case "services":
        return serviceColumns as Column<{ name: string }>[];
      default:
        return nodeColumns as Column<{ name: string }>[];
    }
  }, [kind]);

  function onRowClick(row: { name: string }) {
    if (kind === "events") return; // events have no manifest detail
    if (kind === "pods") {
      setSelectedPod(row as PodSummary);
    } else {
      const rowNs = (row as { namespace?: string }).namespace;
      setOtherDetail({
        kind: K8S_KIND[kind],
        namespace: namespaced ? rowNs || namespace || null : null,
        name: row.name,
      });
    }
  }

  // Deep-link from global search: once rows load, open the target's detail.
  const focusHandledRef = useRef(0);
  useEffect(() => {
    if (!focus || focus.nonce === focusHandledRef.current) return;
    const row = res.rows.find(
      (r) =>
        r.name === focus.name &&
        (focus.namespace == null || (r as { namespace?: string }).namespace === focus.namespace),
    );
    if (row) {
      focusHandledRef.current = focus.nonce;
      onRowClick(row);
    }
    // onRowClick is stable enough for this one-shot; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, res.rows]);

  const selectedKey = kind === "pods" ? selectedPod?.name : otherDetail?.name;

  // Merge live pod metrics into the pod rows (other kinds pass through).
  const tableRows = useMemo(() => {
    if (kind !== "pods") return res.rows;
    return (res.rows as PodSummary[]).map((p) => {
      const m = podCpuMem.get(p.name);
      return { ...p, cpu: m?.cpu, memory: m?.mem } as PodRow;
    });
  }, [res.rows, kind, podCpuMem]);

  const filtered = useMemo(
    () => filterTableData(tableRows, columns, query, filterColumn),
    [columns, filterColumn, query, tableRows],
  );
  const filterLabel = filterColumn
    ? columns.find((column) => column.key === filterColumn)?.header
    : null;

  function closeDetail() {
    setSelectedPod(null);
    setOtherDetail(null);
  }

  const detailTitle = selectedPod ? (
    <>Pod: <code>{selectedPod.name}</code></>
  ) : otherDetail ? (
    <>{otherDetail.kind}: <code>{otherDetail.name}</code></>
  ) : null;

  const detailActions = selectedPod ? (
    <PodActions
      context={context}
      pod={selectedPod}
      onDeleted={closeDetail}
      onOpenTerminal={onOpenTerminal}
      onOpenLogs={onOpenLogs}
    />
  ) : otherDetail ? (
    <>
      {otherDetail.kind === "Node" && (
        <NodeCordonAction context={context} name={otherDetail.name} />
      )}
      {otherDetail.kind === "Service" && (
        <ServiceForwardAction
          context={context}
          namespace={otherDetail.namespace}
          name={otherDetail.name}
        />
      )}
      <ResourceActions
        context={context}
        kind={otherDetail.kind}
        namespace={otherDetail.namespace}
        name={otherDetail.name}
        onDeleted={closeDetail}
        onOpenLogs={onOpenWorkloadLogs}
      />
    </>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {nsError && <p className="px-3 py-2 text-sm text-destructive">Error: {nsError}</p>}
        {!nsError && namespaces === null && (
          <div className="p-3">
            <Spinner label="Loading namespaces" />
          </div>
        )}
        {!nsError && namespaces !== null && (
          <>
            <Toolbar className="fl-resource-toolbar shrink-0 flex-wrap">
              {namespaced && (
                <div className="fl-resource-toolbar__namespace flex items-center gap-2">
                  <span>Namespace</span>
                  <Combobox
                    value={namespace}
                    onValueChange={changeNamespace}
                    options={[
                      { value: "", label: "All namespaces" },
                      ...namespaces.map((n) => ({ value: n })),
                    ]}
                    ariaLabel="Namespace"
                    searchPlaceholder="Search namespaces…"
                    className="min-w-44"
                  />
                </div>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={res.loading}
              >
                <RefreshCw data-icon="inline-start" />
                Refresh
              </Button>
              {onOpenNew && (
                <Button variant="ghost" size="sm" onClick={() => onOpenNew(K8S_KIND[kind] || undefined)}>
                  <Plus data-icon="inline-start" />
                  New
                </Button>
              )}
              {isWatchable(kind) &&
                !res.loading &&
                (watchStatus === "reconnecting" ? (
                  <Badge variant="warning">reconnecting…</Badge>
                ) : (
                  <Badge variant="success">live</Badge>
                ))}
              {res.loading && <Spinner label="Loading resources" />}
              <div className="fl-resource-toolbar__search ml-auto w-56">
                <TextInput
                  value={query}
                  onValueChange={(q) => onQueryChange?.(q)}
                  type="search"
                  placeholder={typeof filterLabel === "string" ? `Search ${filterLabel}…` : "Search all columns…"}
                  aria-label="Search resources"
                />
              </div>
              {!res.error && (
                <span className="fl-resource-toolbar__count tabular-nums">
                  {filtered.length} {filtered.length === 1 ? "item" : "items"}
                </span>
              )}
            </Toolbar>

            <div className="min-h-0 flex-1 overflow-auto">
              {res.error && <p className="px-3 py-2 text-sm text-destructive">Error: {res.error}</p>}
              {!res.error && (
                <Table
                  columns={columns}
                  data={filtered}
                  getRowKey={(r) => r.name}
                  selectedKey={selectedKey}
                  onRowClick={kind === "events" ? undefined : onRowClick}
                  activeFilterKey={filterColumn}
                  onActiveFilterKeyChange={setFilterColumn}
                  emptyText={
                    query ? "No matches" : `No ${kind}${namespaced && namespace ? ` in ${namespace}` : ""}`
                  }
                />
              )}
            </div>
          </>
        )}
      </div>

      <Drawer
        open={!!selectedPod || !!otherDetail}
        defaultWidth={detailDrawerWidth}
        title={detailTitle}
        headerActions={detailActions}
        onClose={closeDetail}
      >
        {selectedPod && (
          <ResourceDetail
            context={context}
            kind="Pod"
            namespace={selectedPod.namespace}
            name={selectedPod.name}
            onOpenResource={onOpenResource}
          />
        )}
        {otherDetail && (
          <ResourceDetail
            context={context}
            kind={otherDetail.kind}
            namespace={otherDetail.namespace}
            name={otherDetail.name}
            onOpenResource={onOpenResource}
          />
        )}
      </Drawer>
    </div>
  );
}
