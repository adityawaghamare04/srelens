import React, { useEffect, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronUp } from "lucide-react";
import type { X509Certificate } from "@peculiar/x509";
import { getObject, type K8sObject } from "../lib/manifest";
import {
  Spinner,
  StatusPill,
  Badge,
  Table,
  IconButton,
  type StatusKind,
  type BadgeVariant,
  type Column,
} from "../ui";
import { DeployRevisions, ManagedPods } from "./WorkloadRelations";
import { MetricsPanel } from "./MetricsPanel";
import { ForwardDialog } from "./ForwardDialog";
import {
  isNavigableResourceKind,
  targetNamespace,
  type OpenResource,
  type ResourceTarget,
} from "../lib/resourceNavigation";

/* ------------------------------------------------------------------ */
/* small value helpers                                                 */
/* ------------------------------------------------------------------ */

/** Relative age from an ISO timestamp, e.g. "5d", "3h", "10m". */
export function ageFromTimestamp(iso?: string, now: number = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Absolute, human-readable timestamp, e.g. "Jun 10, 2026, 12:52:33 PM". */
export function absoluteTimestamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return String(v);
}
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

type Pair = [label: string, value: React.ReactNode];

/** Render a definition-list grid, skipping rows whose value is empty. */
function KV({ pairs }: { pairs: Pair[] }) {
  const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—");
  if (rows.length === 0) return null;
  return (
    <dl className="fl-kv">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fl-detail-section">
      <h4 className="fl-detail-section__title">{title}</h4>
      {children}
    </section>
  );
}

function ResourceLink({
  target,
  onOpenResource,
  children,
}: {
  target: ResourceTarget;
  onOpenResource?: OpenResource;
  children?: React.ReactNode;
}) {
  const content = children ?? target.name;
  if (!onOpenResource || !target.name || !isNavigableResourceKind(target.kind))
    return <span className="fl-mono">{content}</span>;
  return (
    <button
      type="button"
      className="fl-link fl-mono"
      aria-label={`Open ${target.kind} ${target.name}`}
      title={`Open ${target.kind}`}
      onClick={() => onOpenResource(target)}
    >
      {content}
    </button>
  );
}

function LinkedResources({
  targets,
  onOpenResource,
}: {
  targets: ResourceTarget[];
  onOpenResource?: OpenResource;
}) {
  return (
    <span>
      {targets.map((target, index) => (
        <React.Fragment key={`${target.kind}/${target.namespace ?? ""}/${target.name}/${index}`}>
          {index > 0 && ", "}
          <ResourceLink target={target} onOpenResource={onOpenResource}>
            {target.kind}/{target.name}
          </ResourceLink>
        </React.Fragment>
      ))}
    </span>
  );
}

/** Render a key/value map (labels, annotations, selectors) as chips. */
function Chips({ map }: { map?: Record<string, string> }) {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return <span className="fl-detail-empty">None</span>;
  return (
    <div className="fl-chips">
      {entries.map(([k, v]) => (
        <span className="fl-chip" key={k} title={`${k}: ${v}`}>
          <span className="fl-chip__key">{k}</span>
          {v !== "" && <span className="fl-chip__val">{v}</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * A count summary that expands to its full content on click — the Srelens
 * idiom for long label/annotation/toleration lists that would dominate the
 * panel ("6 Labels ⌄").
 */
function Expandable({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fl-expandable">
      <button
        type="button"
        className="fl-expandable__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
        <span className="fl-expandable__caret">
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </span>
      </button>
      {open && <div className="fl-expandable__body">{children}</div>}
    </div>
  );
}

function CollapsibleText({
  text,
  label,
  lines = 4,
  muted = false,
}: {
  text: string;
  label: string;
  lines?: number;
  muted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 120 || text.split("\n").length > lines;
  if (!long) return <span className={`fl-mono${muted ? " fl-command" : ""}`}>{text}</span>;
  return (
    <div className="fl-collapsible-value">
      <span
        className={`fl-mono fl-collapsible-value__content${muted ? " fl-command" : ""}${expanded ? "" : " fl-collapsible-value__content--collapsed"}`}
        style={{ "--fl-collapse-lines": lines } as React.CSSProperties}
      >
        {text}
      </span>
      <button
        type="button"
        className="fl-collapsible-value__toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Show full"} ${label}`}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "Collapse" : "Show full"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* conditions                                                          */
/* ------------------------------------------------------------------ */

interface Condition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

function conditionKind(c: Condition): StatusKind {
  const negative = /Pressure|Unavailable|Failed|Dangling|NetworkUnavailable/i.test(c.type);
  if (c.status === "Unknown") return "warning";
  const good = c.status === "True" ? !negative : negative;
  return good ? "success" : "danger";
}

function conditionBadgeVariant(c: Condition): BadgeVariant {
  if (c.status === "Unknown") return "warning";
  const negative = /Pressure|Unavailable|Failed|Failure|Dangling/i.test(c.type);
  if (c.status !== "True") return negative ? "success" : "neutral";
  if (/Progressing/i.test(c.type)) return "info";
  return negative ? "danger" : "success";
}

/** Conditions as a row of coloured badges (Pod/Deployment-style). */
function ConditionBadges({ conditions }: { conditions: Condition[] }) {
  if (conditions.length === 0) return <span className="fl-detail-empty">None</span>;
  return (
    <div className="fl-chips">
      {conditions.map((c) => (
        <Badge key={c.type} variant={conditionBadgeVariant(c)}>
          {c.type}
        </Badge>
      ))}
    </div>
  );
}

/** Conditions as a table (workload/node-style). */
function ConditionsTable({ conditions, now }: { conditions: Condition[]; now: number }) {
  if (conditions.length === 0) return null;
  const columns: Column<Condition>[] = [
    {
      key: "type",
      header: "Type",
      render: (c) => <StatusPill status={c.type} kind={conditionKind(c)} />,
    },
    { key: "status", header: "Status", render: (c) => c.status },
    { key: "reason", header: "Reason", render: (c) => c.reason || "—" },
    {
      key: "age",
      header: "Last transition",
      render: (c) => ageFromTimestamp(c.lastTransitionTime, now),
    },
  ];
  return (
    <Section title="Conditions">
      <Table columns={columns} data={conditions} getRowKey={(c) => c.type} />
    </Section>
  );
}

function phaseKind(phase: string): StatusKind {
  if (phase === "Running" || phase === "Succeeded" || phase === "Active" || phase === "Bound")
    return "success";
  if (phase === "Pending") return "warning";
  if (phase === "Failed" || phase === "Unknown" || phase === "Lost") return "danger";
  return "neutral";
}

/* ------------------------------------------------------------------ */
/* Pod detail (rich Srelens presentation)                              */
/* ------------------------------------------------------------------ */

const VOLUME_TYPE_LABELS: Record<string, string> = {
  persistentVolumeClaim: "Persistent Volume Claim",
  emptyDir: "Empty Dir",
  secret: "Secret",
  configMap: "Config Map",
  projected: "Projected",
  hostPath: "Host Path",
  downwardAPI: "Downward API",
  nfs: "NFS",
  csi: "CSI",
};

const PERSISTENT_VOLUME_SOURCE_TYPES = new Set([
  "awsElasticBlockStore",
  "azureDisk",
  "azureFile",
  "cephfs",
  "cinder",
  "csi",
  "fc",
  "flexVolume",
  "flocker",
  "gcePersistentDisk",
  "glusterfs",
  "hostPath",
  "iscsi",
  "local",
  "nfs",
  "photonPersistentDisk",
  "portworxVolume",
  "quobyte",
  "rbd",
  "scaleIO",
  "storageos",
  "vsphereVolume",
]);

/** Describe a container's runtime state, e.g. "running, ready". */
function containerStateText(st: Record<string, unknown>): { text: string; kind: StatusKind } {
  const state = asRecord(st.state);
  const ready = st.ready === true ? ", ready" : "";
  if ("running" in state) return { text: `running${ready}`, kind: "success" };
  if ("waiting" in state) {
    const reason = str(asRecord(state.waiting).reason) || "waiting";
    return { text: `waiting - ${reason}`, kind: reason.includes("BackOff") ? "danger" : "warning" };
  }
  if ("terminated" in state) {
    const t = asRecord(state.terminated);
    const reason = str(t.reason) || "terminated";
    const code = t.exitCode != null ? ` (exit code: ${str(t.exitCode)})` : "";
    return {
      text: `terminated${ready} - ${reason}${code}`,
      kind: reason === "Completed" ? "neutral" : "danger",
    };
  }
  return { text: "—", kind: "neutral" };
}

/** The previous termination marks when Kubernetes last restarted a container. */
export function containerLastRestartTime(status: unknown): string {
  const st = asRecord(status);
  if (Number(st.restartCount ?? 0) < 1) return "";
  return str(asRecord(asRecord(st.lastState).terminated).finishedAt);
}

function timestampWithAge(iso: string, now: number): string {
  return iso ? `${ageFromTimestamp(iso, now)} ago (${absoluteTimestamp(iso)})` : "";
}

function latestRestartTime(statuses: Record<string, unknown>[]): string {
  return statuses
    .map(containerLastRestartTime)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? "";
}

/** Format a port as "name: port/protocol". */
function portText(p: Record<string, unknown>): string {
  const name = str(p.name);
  const proto = str(p.protocol) || "TCP";
  return `${name ? `${name}: ` : ""}${str(p.containerPort)}/${proto}`;
}

/** Probe → chips: "tcp-socket :cluster delay=30s timeout=1s period=10s …". */
function probeChips(probe: Record<string, unknown>): string[] {
  const chips: string[] = [];
  if (probe.httpGet) {
    const h = asRecord(probe.httpGet);
    chips.push(`http-get ${str(h.scheme || "HTTP").toLowerCase()}://:${str(h.port)}${str(h.path)}`);
  } else if (probe.tcpSocket) {
    chips.push(`tcp-socket :${str(asRecord(probe.tcpSocket).port)}`);
  } else if (probe.exec) {
    chips.push(`exec [${asArray(asRecord(probe.exec).command).map(str).join(" ")}]`);
  }
  if (probe.initialDelaySeconds != null) chips.push(`delay=${str(probe.initialDelaySeconds)}s`);
  if (probe.timeoutSeconds != null) chips.push(`timeout=${str(probe.timeoutSeconds)}s`);
  if (probe.periodSeconds != null) chips.push(`period=${str(probe.periodSeconds)}s`);
  if (probe.successThreshold != null) chips.push(`#success=${str(probe.successThreshold)}`);
  if (probe.failureThreshold != null) chips.push(`#failure=${str(probe.failureThreshold)}`);
  return chips;
}

function resourceText(r: Record<string, unknown>): string {
  return `CPU: ${str(r.cpu) || "—"}, Memory: ${str(r.memory) || "—"}`;
}

/** "NAME=value" or "NAME=<secret/configMap/field>" for an env entry. */
function envText(e: unknown): string {
  const r = asRecord(e);
  const name = str(r.name);
  if (r.value != null) return `${name}=${str(r.value)}`;
  const vf = asRecord(r.valueFrom);
  const src = vf.secretKeyRef
    ? "secret"
    : vf.configMapKeyRef
      ? "configMap"
      : vf.fieldRef
        ? "field"
        : vf.resourceFieldRef
          ? "resource"
          : "ref";
  return `${name}=<${src}>`;
}

/** "mountPath (ro) ← volume" for a volumeMount entry. */
function mountText(m: unknown): string {
  const r = asRecord(m);
  const ro = r.readOnly === true ? " (ro)" : "";
  return `${str(r.mountPath)}${ro} ← ${str(r.name)}`;
}

function PlainChips({ items }: { items: string[] }) {
  return (
    <div className="fl-chips">
      {items.map((t, i) => (
        <span className="fl-chip fl-chip--plain" key={`${t}-${i}`}>
          {t}
        </span>
      ))}
    </div>
  );
}

/** One container (or init container) block. */
/** Target a port-forward can attach to (a Pod or Service in a context). */
export interface ForwardTarget {
  context: string;
  namespace: string;
  kind: "Pod" | "Service";
  name: string;
}

/**
 * Inline "forward" affordance for a single port: a compact icon button that
 * opens the forward dialog pre-filled with that port. Renders nothing without
 * a forward target (e.g. in tests, or when no context is available).
 */
function PortForwardButton({ target, port }: { target?: ForwardTarget; port?: number }) {
  const [open, setOpen] = useState(false);
  if (!target || !port) return null;
  return (
    <span className="fl-port-forward">
      <IconButton icon={ArrowLeftRight} label={`Forward port ${port}`} onClick={() => setOpen(true)} />
      {open && (
        <ForwardDialog
          context={target.context}
          namespace={target.namespace}
          kind={target.kind}
          name={target.name}
          defaultRemotePort={port}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

/** A port row with an inline forward button (used in Pod/Service detail). */
function ForwardablePorts({
  ports,
  target,
  portOf,
}: {
  ports: Record<string, unknown>[];
  target?: ForwardTarget;
  portOf: (p: Record<string, unknown>) => number | undefined;
}) {
  return (
    <div className="fl-chips">
      {ports.map((p, i) => (
        <span key={i} className="fl-port-chip">
          <span className="fl-chip fl-chip--plain">{portText(p)}</span>
          <PortForwardButton target={target} port={portOf(p)} />
        </span>
      ))}
    </div>
  );
}

function ContainerCard({
  container,
  status,
  forward,
  now,
}: {
  container: Record<string, unknown>;
  status?: Record<string, unknown>;
  forward?: ForwardTarget;
  now: number;
}) {
  const name = str(container.name);
  const st = status ? containerStateText(status) : null;
  const ports = asArray(container.ports).map(asRecord);
  const env = asArray(container.env);
  const mounts = asArray(container.volumeMounts);
  const resources = asRecord(container.resources);
  const requests = asRecord(resources.requests);
  const limits = asRecord(resources.limits);
  const liveness = asRecord(container.livenessProbe);
  const readiness = asRecord(container.readinessProbe);
  const command = [...asArray(container.command), ...asArray(container.args)].map(str).join(" ");
  const restartCount = status?.restartCount;
  const lastRestart = containerLastRestartTime(status);
  const runningSince = str(asRecord(asRecord(status?.state).running).startedAt);

  return (
    <div className="fl-container-card">
      <div className="fl-container-card__name">
        <span className={`fl-status__dot fl-status--${st?.kind ?? "neutral"}`} />
        {name}
      </div>
      <KV
        pairs={[
          ["Status", st ? <span className={`fl-status--${st.kind} fl-status-text`}>{st.text}</span> : ""],
          ["Restarts", restartCount != null ? str(restartCount) : ""],
          ["Last restart", timestampWithAge(lastRestart, now)],
          ["Running since", timestampWithAge(runningSince, now)],
          ["Image", <CollapsibleText text={str(container.image)} label="image" lines={2} />],
          [
            "Ports",
            ports.length ? (
              <ForwardablePorts
                ports={ports}
                target={forward}
                portOf={(p) => Number(p.containerPort) || undefined}
              />
            ) : (
              ""
            ),
          ],
          [
            "Environment",
            env.length ? (
              <Expandable summary={plural(env.length, "environment variable")}>
                <PlainChips items={env.map(envText)} />
              </Expandable>
            ) : (
              ""
            ),
          ],
          [
            "Mounts",
            mounts.length ? (
              <Expandable summary={plural(mounts.length, "mount")}>
                <PlainChips items={mounts.map(mountText)} />
              </Expandable>
            ) : (
              ""
            ),
          ],
          ["Liveness", Object.keys(liveness).length ? <PlainChips items={probeChips(liveness)} /> : ""],
          ["Readiness", Object.keys(readiness).length ? <PlainChips items={probeChips(readiness)} /> : ""],
          ["Command", command ? <CollapsibleText text={command} label="command" muted /> : ""],
          ["Requests", Object.keys(requests).length ? resourceText(requests) : ""],
          ["Limits", Object.keys(limits).length ? resourceText(limits) : ""],
        ]}
      />
    </div>
  );
}

function PodDetailView({
  obj,
  now,
  context = "",
  onOpenResource,
}: {
  obj: K8sObject;
  now: number;
  context?: string;
  onOpenResource?: OpenResource;
}) {
  const meta = asRecord(obj.metadata);
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const labels = (meta.labels ?? {}) as Record<string, string>;
  const annotations = (meta.annotations ?? {}) as Record<string, string>;
  const owners = asArray(meta.ownerReferences).map(asRecord);
  const conditions = asArray(status.conditions) as unknown as Condition[];
  const podIPs = asArray(status.podIPs).map((p) => str(asRecord(p).ip)).filter(Boolean);
  const tolerations = asArray(spec.tolerations);
  const created = str(meta.creationTimestamp);
  const namespace = str(meta.namespace) || null;
  const forward: ForwardTarget | undefined = context
    ? { context, namespace: str(meta.namespace), kind: "Pod", name: str(meta.name) }
    : undefined;

  const podVolumes = asArray(spec.volumes).map(asRecord);
  const ownerTargets = owners
    .map((owner) => ({
      kind: str(owner.kind),
      name: str(owner.name),
      namespace: targetNamespace(str(owner.kind), namespace),
    }))
    .filter((target) => target.kind && target.name);
  const imagePullSecrets = asArray(spec.imagePullSecrets)
    .map((secret) => str(asRecord(secret).name))
    .filter(Boolean);

  const containerStatuses = new Map(
    asArray(status.containerStatuses).map((s) => [str(asRecord(s).name), asRecord(s)]),
  );
  const initStatuses = new Map(
    asArray(status.initContainerStatuses).map((s) => [str(asRecord(s).name), asRecord(s)]),
  );
  const allContainerStatuses = [
    ...asArray(status.initContainerStatuses),
    ...asArray(status.containerStatuses),
    ...asArray(status.ephemeralContainerStatuses),
  ].map(asRecord);
  const podRestartCount = allContainerStatuses.reduce(
    (total, containerStatus) => total + Number(containerStatus.restartCount ?? 0),
    0,
  );
  const podLastRestart = latestRestartTime(allContainerStatuses);

  const phase = str(status.phase);
  const volumeSource = (volume: Record<string, unknown>): React.ReactNode => {
    const pvc = asRecord(volume.persistentVolumeClaim);
    const configMap = asRecord(volume.configMap);
    const secret = asRecord(volume.secret);
    if (pvc.claimName)
      return (
        <ResourceLink
          target={{ kind: "PersistentVolumeClaim", namespace, name: str(pvc.claimName) }}
          onOpenResource={onOpenResource}
        />
      );
    if (configMap.name)
      return (
        <ResourceLink
          target={{ kind: "ConfigMap", namespace, name: str(configMap.name) }}
          onOpenResource={onOpenResource}
        />
      );
    if (secret.secretName)
      return (
        <ResourceLink
          target={{ kind: "Secret", namespace, name: str(secret.secretName) }}
          onOpenResource={onOpenResource}
        />
      );
    if (volume.hostPath) return <span className="fl-mono">{str(asRecord(volume.hostPath).path)}</span>;
    if (volume.nfs) {
      const nfs = asRecord(volume.nfs);
      return <span className="fl-mono">{str(nfs.server)}:{str(nfs.path)}</span>;
    }
    if (volume.csi) return <span className="fl-mono">{str(asRecord(volume.csi).driver)}</span>;
    if (volume.projected) {
      const sources = asArray(asRecord(volume.projected).sources).map(asRecord);
      const targets = sources.flatMap((source): ResourceTarget[] => {
        const projectedConfigMap = asRecord(source.configMap);
        const projectedSecret = asRecord(source.secret);
        if (projectedConfigMap.name)
          return [{ kind: "ConfigMap", namespace, name: str(projectedConfigMap.name) }];
        if (projectedSecret.name)
          return [{ kind: "Secret", namespace, name: str(projectedSecret.name) }];
        return [];
      });
      return targets.length ? (
        <LinkedResources targets={targets} onOpenResource={onOpenResource} />
      ) : (
        `${sources.length} projected sources`
      );
    }
    if (volume.emptyDir) return str(asRecord(volume.emptyDir).medium) || "Node temporary storage";
    return "—";
  };
  const volumeColumns: Column<Record<string, unknown>>[] = [
    { key: "name", header: "Name", render: (volume) => <span className="fl-mono">{str(volume.name)}</span> },
    {
      key: "type",
      header: "Type",
      render: (volume) => {
        const type = Object.keys(volume).find((key) => key !== "name") ?? "unknown";
        return VOLUME_TYPE_LABELS[type] ?? type;
      },
    },
    { key: "source", header: "Source", render: volumeSource },
  ];

  return (
    <div className="fl-detail">
      <Section title="Properties">
        <KV
          pairs={[
            ["Created", created ? `${ageFromTimestamp(created, now)} ago (${absoluteTimestamp(created)})` : ""],
            ["Name", <span className="fl-mono">{str(meta.name)}</span>],
            [
              "Namespace",
              meta.namespace ? (
                <ResourceLink
                  target={{ kind: "Namespace", namespace: null, name: str(meta.namespace) }}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            [
              "Labels",
              Object.keys(labels).length ? (
                <Expandable summary={plural(Object.keys(labels).length, "Label")}>
                  <Chips map={labels} />
                </Expandable>
              ) : (
                ""
              ),
            ],
            [
              "Annotations",
              Object.keys(annotations).length ? (
                <Expandable summary={plural(Object.keys(annotations).length, "Annotation")}>
                  <Chips map={annotations} />
                </Expandable>
              ) : (
                ""
              ),
            ],
            [
              "Controlled By",
              ownerTargets.length ? (
                <LinkedResources targets={ownerTargets} onOpenResource={onOpenResource} />
              ) : (
                ""
              ),
            ],
            ["Status", <StatusPill key="s" status={phase || "—"} kind={phaseKind(phase)} />],
            ["Container restarts", str(podRestartCount)],
            ["Last restart", timestampWithAge(podLastRestart, now)],
            [
              "Node",
              spec.nodeName ? (
                <ResourceLink
                  target={{ kind: "Node", namespace: null, name: str(spec.nodeName) }}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            ["Pod IP", <span className="fl-mono">{str(status.podIP)}</span>],
            ["Pod IPs", podIPs.length ? <PlainChips items={podIPs} /> : ""],
            [
              "Service Account",
              spec.serviceAccountName ? (
                <ResourceLink
                  target={{ kind: "ServiceAccount", namespace, name: str(spec.serviceAccountName) }}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            [
              "Priority Class",
              spec.priorityClassName ? (
                <ResourceLink
                  target={{ kind: "PriorityClass", namespace: null, name: str(spec.priorityClassName) }}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            [
              "Runtime Class",
              spec.runtimeClassName ? (
                <ResourceLink
                  target={{ kind: "RuntimeClass", namespace: null, name: str(spec.runtimeClassName) }}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            [
              "Image pull secrets",
              imagePullSecrets.length ? (
                <LinkedResources
                  targets={imagePullSecrets.map((name) => ({ kind: "Secret", namespace, name }))}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            ["QoS Class", str(status.qosClass)],
            ["Conditions", <ConditionBadges key="c" conditions={conditions} />],
            ["Tolerations", tolerations.length ? plural(tolerations.length, "toleration") : ""],
          ]}
        />
      </Section>

      {podVolumes.length > 0 && (
        <Section title="Pod Volumes">
          <Table
            columns={volumeColumns}
            data={podVolumes}
            getRowKey={(volume) => str(volume.name)}
          />
        </Section>
      )}

      {asArray(spec.initContainers).length > 0 && (
        <Section title="Init Containers">
          {asArray(spec.initContainers).map((c) => {
            const cr = asRecord(c);
            return (
              <ContainerCard
                key={str(cr.name)}
                container={cr}
                status={initStatuses.get(str(cr.name))}
                now={now}
              />
            );
          })}
        </Section>
      )}

      <Section title="Containers">
        {asArray(spec.containers).length === 0 ? (
          <span className="fl-detail-empty">No containers</span>
        ) : (
          asArray(spec.containers).map((c) => {
            const cr = asRecord(c);
            return (
              <ContainerCard
                key={str(cr.name)}
                container={cr}
                status={containerStatuses.get(str(cr.name))}
                forward={forward}
                now={now}
              />
            );
          })
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* other kinds                                                         */
/* ------------------------------------------------------------------ */

/** A single-section "Properties" view for Deployments/StatefulSets/ReplicaSets. */
function WorkloadDetailView({
  kind,
  obj,
  now,
  context,
  onOpenResource,
}: {
  kind: string;
  obj: K8sObject;
  now: number;
  context: string;
  onOpenResource?: OpenResource;
}) {
  const meta = asRecord(obj.metadata);
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const labels = (meta.labels ?? {}) as Record<string, string>;
  const annotations = (meta.annotations ?? {}) as Record<string, string>;
  const selector = asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
  const name = str(meta.name);
  const namespace = str(meta.namespace);
  const conditions = asArray(status.conditions) as unknown as Condition[];
  const owners = asArray(meta.ownerReferences).map(asRecord);
  const ownerTargets = owners
    .map((owner) => ({
      kind: str(owner.kind),
      name: str(owner.name),
      namespace: targetNamespace(str(owner.kind), namespace),
    }))
    .filter((target) => target.kind && target.name);
  const created = str(meta.creationTimestamp);

  const num = (v: unknown) => (v != null ? Number(v) : 0);
  const desired = spec.replicas != null ? num(spec.replicas) : 0;
  const total = num(status.replicas);
  const updated = num(status.updatedReplicas);
  const available = num(status.availableReplicas);
  const unavailable = num(status.unavailableReplicas);
  const replicaText = `${desired} desired, ${updated} updated, ${total} total, ${available} available, ${unavailable} unavailable`;

  // Srelens shows "Running" once the workload is fully available.
  const running = desired > 0 && available >= desired;
  const phase = running ? "Running" : "Pending";

  return (
    <div className="fl-detail">
      <Section title="Properties">
        <KV
          pairs={[
            ["Created", created ? `${ageFromTimestamp(created, now)} ago (${absoluteTimestamp(created)})` : ""],
            ["Name", <span className="fl-mono">{str(meta.name)}</span>],
            [
              "Namespace",
              meta.namespace ? (
                <ResourceLink
                  target={{ kind: "Namespace", namespace: null, name: str(meta.namespace) }}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            [
              "Labels",
              Object.keys(labels).length ? (
                <Expandable summary={plural(Object.keys(labels).length, "Label")}>
                  <Chips map={labels} />
                </Expandable>
              ) : (
                ""
              ),
            ],
            [
              "Annotations",
              Object.keys(annotations).length ? (
                <Expandable summary={plural(Object.keys(annotations).length, "Annotation")}>
                  <Chips map={annotations} />
                </Expandable>
              ) : (
                ""
              ),
            ],
            ["Replicas", replicaText],
            ["Selector", <Chips key="s" map={selector} />],
            [
              "Managed By",
              ownerTargets.length ? (
                <LinkedResources targets={ownerTargets} onOpenResource={onOpenResource} />
              ) : (
                ""
              ),
            ],
            ["Strategy Type", str(asRecord(spec.strategy).type) || str(spec.updateStrategy && asRecord(spec.updateStrategy).type)],
            ["Status", <StatusPill key="st" status={phase} kind={phaseKind(phase)} />],
            ["Conditions", <ConditionBadges key="c" conditions={conditions} />],
          ]}
        />
      </Section>

      {kind === "Deployment" && (
        <DeployRevisions
          context={context}
          namespace={namespace}
          ownerName={name}
          onOpenResource={onOpenResource}
        />
      )}
      {Object.keys(selector).length > 0 && (
        <ManagedPods
          context={context}
          namespace={namespace}
          selector={selector}
          onOpenResource={onOpenResource}
        />
      )}
    </div>
  );
}

function DaemonSetBody({ obj }: { obj: K8sObject }) {
  const status = asRecord(obj.status);
  const selector = asRecord(asRecord(asRecord(obj.spec).selector).matchLabels) as Record<string, string>;
  return (
    <Section title="Scheduling">
      <KV
        pairs={[
          ["Desired", str(status.desiredNumberScheduled)],
          ["Current", str(status.currentNumberScheduled)],
          ["Ready", str(status.numberReady)],
          ["Up-to-date", str(status.updatedNumberScheduled)],
          ["Available", str(status.numberAvailable)],
          ["Selector", <Chips key="s" map={selector} />],
        ]}
      />
    </Section>
  );
}

interface PortRow {
  key: string;
  name: string;
  port: string;
  target: string;
  protocol: string;
  /** The service port number, for the inline forward button. */
  servicePort?: number;
}

function ServiceBody({ obj, context = "" }: { obj: K8sObject; context?: string }) {
  const spec = asRecord(obj.spec);
  const meta = asRecord(obj.metadata);
  const selector = asRecord(spec.selector) as Record<string, string>;
  const ports: PortRow[] = asArray(spec.ports).map((p, i) => {
    const pr = asRecord(p);
    return {
      key: str(pr.name) || `port-${i}`,
      name: str(pr.name) || "—",
      port: str(pr.port) + (pr.nodePort ? `:${str(pr.nodePort)}` : ""),
      target: str(pr.targetPort),
      protocol: str(pr.protocol) || "TCP",
      servicePort: Number(pr.port) || undefined,
    };
  });
  // Headless/ExternalName services can't be port-forwarded (no backing pod to
  // attach to), so only offer it when there's a selector.
  const forward: ForwardTarget | undefined =
    context && Object.keys(selector).length > 0
      ? { context, namespace: str(meta.namespace), kind: "Service", name: str(meta.name) }
      : undefined;
  const portCols: Column<PortRow>[] = [
    { key: "name", header: "Name", render: (p) => p.name },
    { key: "port", header: "Port", render: (p) => <span className="fl-mono">{p.port}</span> },
    { key: "target", header: "Target", render: (p) => <span className="fl-mono">{p.target}</span> },
    { key: "protocol", header: "Protocol", render: (p) => p.protocol },
    ...(forward
      ? [
          {
            key: "forward",
            header: "",
            render: (p: PortRow) => <PortForwardButton target={forward} port={p.servicePort} />,
          } as Column<PortRow>,
        ]
      : []),
  ];
  return (
    <>
      <Section title="Connection">
        <KV
          pairs={[
            ["Type", str(spec.type) || "ClusterIP"],
            ["Cluster IP", <span className="fl-mono">{str(spec.clusterIP)}</span>],
            ["Session affinity", str(spec.sessionAffinity)],
            ["Selector", <Chips key="s" map={selector} />],
          ]}
        />
      </Section>
      {ports.length > 0 && (
        <Section title="Ports">
          <Table columns={portCols} data={ports} getRowKey={(p) => p.key} />
        </Section>
      )}
    </>
  );
}

function NodeBody({ obj }: { obj: K8sObject }) {
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const info = asRecord(status.nodeInfo);
  const cap = asRecord(status.capacity);
  const alloc = asRecord(status.allocatable);
  const cordoned = spec.unschedulable === true;
  return (
    <>
      <Section title="Info">
        <KV
          pairs={[
            [
              "Scheduling",
              <StatusPill
                key="s"
                status={cordoned ? "Disabled (cordoned)" : "Enabled"}
                kind={cordoned ? "warning" : "success"}
              />,
            ],
            ["Kubelet", str(info.kubeletVersion)],
            ["OS image", str(info.osImage)],
            ["Kernel", str(info.kernelVersion)],
            ["Container runtime", str(info.containerRuntimeVersion)],
            ["Architecture", str(info.architecture)],
          ]}
        />
      </Section>
      <Section title="Capacity">
        <KV
          pairs={[
            ["CPU", `${str(alloc.cpu)} / ${str(cap.cpu)}`],
            ["Memory", `${str(alloc.memory)} / ${str(cap.memory)}`],
            ["Pods", `${str(alloc.pods)} / ${str(cap.pods)}`],
          ]}
        />
      </Section>
    </>
  );
}

function JobBody({ obj }: { obj: K8sObject }) {
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  return (
    <Section title="Job">
      <KV
        pairs={[
          ["Completions", str(spec.completions)],
          ["Parallelism", str(spec.parallelism)],
          ["Succeeded", str(status.succeeded) || "0"],
          ["Failed", str(status.failed) || "0"],
          ["Active", str(status.active) || "0"],
        ]}
      />
    </Section>
  );
}

function CronJobBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const namespace = str(asRecord(obj.metadata).namespace) || null;
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
      <KV
        pairs={[
          ["Schedule", <span className="fl-mono">{str(spec.schedule)}</span>],
          ["Suspend", spec.suspend === true ? "Yes" : "No"],
          ["Concurrency policy", str(spec.concurrencyPolicy)],
          [
            "Active jobs",
            activeJobs.length ? (
              <LinkedResources targets={activeJobs} onOpenResource={onOpenResource} />
            ) : (
              "0"
            ),
          ],
        ]}
      />
    </Section>
  );
}

function decodeBase64(v: string): string {
  try {
    const binary = atob(v);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return v;
  }
}

function decodedByteLength(v: string): number {
  try {
    return atob(v).length;
  } catch {
    return new TextEncoder().encode(v).length;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** One ConfigMap/Secret entry: key + value. Secret values are base64-decoded
 *  and masked behind a reveal toggle. */
function ConfigDataEntry({ name, value, secret }: { name: string; value: string; secret: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const display = secret ? (revealed ? decodeBase64(value) : "••••••••") : value;
  return (
    <div className="fl-secret-entry">
      <div className="fl-secret-entry__header">
        <span className="fl-mono">{name}</span>
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            className="fl-secret-entry__toggle"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
        )}
      </div>
      <pre className="fl-secret-entry__value">{display}</pre>
    </div>
  );
}

function SecretData({ data }: { data: Record<string, string> }) {
  const keys = Object.keys(data);
  return (
    <Section title={`Data (${plural(keys.length, "key")})`}>
      {keys.length === 0 ? (
        <span className="fl-detail-empty">No data</span>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map((key) => (
            <ConfigDataEntry key={key} name={key} value={str(data[key])} secret />
          ))}
        </div>
      )}
    </Section>
  );
}

interface CertificateRow {
  key: string;
  role: string;
  subject: string;
  issuer: string;
  serial: string;
  validFrom: string;
  validUntil: string;
  status: string;
  keyAlgorithm: string;
  sans: string[];
  size: string;
}

function publicKeyAlgorithm(certificate: X509Certificate): string {
  const algorithm = certificate.publicKey.algorithm as Algorithm & {
    modulusLength?: number;
    namedCurve?: string;
  };
  if (algorithm.namedCurve) return `${algorithm.name} ${algorithm.namedCurve}`;
  if (algorithm.modulusLength) return `${algorithm.name} ${algorithm.modulusLength}-bit`;
  return algorithm.name;
}

async function certificateRows(pem: string): Promise<CertificateRow[]> {
  await import("reflect-metadata");
  const { SubjectAlternativeNameExtension, X509Certificate } = await import("@peculiar/x509");
  const matches = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  return matches.map((pemCertificate, index) => {
    const fallback: CertificateRow = {
      key: String(index),
      role: index === 0 ? "Leaf" : `Chain ${index}`,
      subject: "Unable to parse certificate",
      issuer: "",
      serial: "",
      validFrom: "",
      validUntil: "",
      status: "Invalid",
      keyAlgorithm: "",
      sans: [],
      size: formatBytes(new TextEncoder().encode(pemCertificate).length),
    };
    try {
      const certificate = new X509Certificate(pemCertificate);
      const now = Date.now();
      const expires = certificate.notAfter.getTime();
      const starts = certificate.notBefore.getTime();
      const status = now < starts
        ? "Not yet valid"
        : now > expires
          ? "Expired"
          : expires - now < 30 * 86_400_000
            ? "Expires soon"
            : "Valid";
      const san = certificate.getExtension(SubjectAlternativeNameExtension);
      return {
        ...fallback,
        subject: certificate.subject,
        issuer: certificate.issuer,
        serial: certificate.serialNumber,
        validFrom: certificate.notBefore.toISOString(),
        validUntil: certificate.notAfter.toISOString(),
        status,
        keyAlgorithm: publicKeyAlgorithm(certificate),
        sans: san?.names.items.map((name) => name.value) ?? [],
      };
    } catch {
      return fallback;
    }
  });
}

function privateKeyType(pem: string): string {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) return "RSA (PKCS#1)";
  if (/BEGIN EC PRIVATE KEY/.test(pem)) return "EC (SEC1)";
  if (/BEGIN ENCRYPTED PRIVATE KEY/.test(pem)) return "Encrypted PKCS#8";
  if (/BEGIN PRIVATE KEY/.test(pem)) return "PKCS#8";
  return pem ? "Unrecognized format" : "Missing";
}

function TlsSecretBody({ obj }: { obj: K8sObject }) {
  const data = asRecord(obj.data) as Record<string, string>;
  const certificate = decodeBase64(str(data["tls.crt"]));
  const privateKey = decodeBase64(str(data["tls.key"]));
  const certificateCount = certificate.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0;
  const [certificates, setCertificates] = useState<CertificateRow[] | null>(null);
  useEffect(() => {
    let active = true;
    if (certificateCount === 0) {
      setCertificates([]);
    } else {
      void certificateRows(certificate)
        .then((rows) => {
          if (active) setCertificates(rows);
        })
        .catch(() => {
          if (active) setCertificates([]);
        });
    }
    return () => {
      active = false;
    };
  }, [certificate, certificateCount]);
  const leaf = certificates?.[0];
  const columns: Column<CertificateRow>[] = [
    { key: "role", header: "Certificate", render: (row) => row.role },
    { key: "subject", header: "Subject", render: (row) => <span className="fl-mono">{row.subject}</span> },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusPill
          status={row.status}
          kind={row.status === "Valid" ? "success" : row.status === "Expires soon" ? "warning" : "danger"}
        />
      ),
    },
    { key: "size", header: "Size", render: (row) => row.size },
  ];
  return (
    <>
      <Section title="TLS material">
        <KV
          pairs={[
            ["Type", "kubernetes.io/tls"],
            ["Certificates", certificateCount ? plural(certificateCount, "certificate") : "Missing tls.crt"],
            ["Private key", privateKeyType(privateKey)],
            [
              "Certificate status",
              leaf ? (
                <StatusPill
                  status={leaf.status}
                  kind={leaf.status === "Valid" ? "success" : leaf.status === "Expires soon" ? "warning" : "danger"}
                />
              ) : (
                ""
              ),
            ],
            ["Subject", leaf?.subject],
            ["Issuer", leaf?.issuer],
            ["Serial number", leaf?.serial ? <span className="fl-mono">{leaf.serial}</span> : ""],
            ["Public key", leaf?.keyAlgorithm],
            ["Valid from", leaf?.validFrom ? absoluteTimestamp(leaf.validFrom) : ""],
            ["Valid until", leaf?.validUntil ? absoluteTimestamp(leaf.validUntil) : ""],
            ["DNS / IP names", leaf?.sans.length ? <PlainChips items={leaf.sans} /> : ""],
            ["Certificate data", data["tls.crt"] ? formatBytes(decodedByteLength(data["tls.crt"])) : ""],
            ["Private key data", data["tls.key"] ? formatBytes(decodedByteLength(data["tls.key"])) : ""],
          ]}
        />
        {certificates === null && certificateCount > 0 && <Spinner label="Reading certificates" />}
        {certificates && certificates.length > 0 && (
          <Table columns={columns} data={certificates} getRowKey={(row) => row.key} />
        )}
      </Section>
      <SecretData data={data} />
    </>
  );
}

interface DockerRegistryRow {
  registry: string;
  username: string;
  credential: string;
}

function dockerRegistries(data: Record<string, string>, type: string): DockerRegistryRow[] {
  const key = type === "kubernetes.io/dockercfg" ? ".dockercfg" : ".dockerconfigjson";
  try {
    const parsed = JSON.parse(decodeBase64(str(data[key]))) as Record<string, unknown>;
    const auths = type === "kubernetes.io/dockercfg" ? parsed : asRecord(parsed.auths);
    return Object.entries(auths).map(([registry, raw]) => {
      const auth = asRecord(raw);
      const decodedAuth = auth.auth ? decodeBase64(str(auth.auth)) : "";
      const username = str(auth.username) || decodedAuth.split(":", 1)[0];
      return {
        registry,
        username: username || "—",
        credential: auth.identitytoken ? "Identity token" : auth.auth || auth.password ? "Stored" : "Missing",
      };
    });
  } catch {
    return [];
  }
}

function DockerSecretBody({ obj }: { obj: K8sObject }) {
  const data = asRecord(obj.data) as Record<string, string>;
  const type = str(obj.type);
  const configKey = type === "kubernetes.io/dockercfg" ? ".dockercfg" : ".dockerconfigjson";
  const registries = dockerRegistries(data, type);
  const columns: Column<DockerRegistryRow>[] = [
    { key: "registry", header: "Registry", render: (row) => <span className="fl-mono">{row.registry}</span> },
    { key: "username", header: "Username", render: (row) => row.username },
    { key: "credential", header: "Credential", render: (row) => row.credential },
  ];
  return (
    <>
      <Section title="Docker registries">
        <KV
          pairs={[
            ["Type", type],
            ["Registries", plural(registries.length, "registry", "registries")],
            ["Config size", data[configKey] ? formatBytes(decodedByteLength(data[configKey])) : ""],
          ]}
        />
        {registries.length ? (
          <Table columns={columns} data={registries} getRowKey={(row) => row.registry} />
        ) : (
          <span className="fl-detail-empty">No valid registry credentials found</span>
        )}
      </Section>
      <SecretData data={data} />
    </>
  );
}

function GeneralSecretBody({ obj }: { obj: K8sObject }) {
  const data = asRecord(obj.data) as Record<string, string>;
  const keys = Object.keys(data);
  const totalBytes = Object.values(data).reduce((total, value) => total + decodedByteLength(str(value)), 0);
  return (
    <>
      <Section title="Secret summary">
        <KV
          pairs={[
            ["Type", str(obj.type) || "Opaque"],
            ["Keys", plural(keys.length, "key")],
            ["Decoded size", formatBytes(totalBytes)],
            ["Immutable", obj.immutable === true ? "Yes" : "No"],
          ]}
        />
      </Section>
      <SecretData data={data} />
    </>
  );
}

function SecretBody({ obj }: { obj: K8sObject }) {
  const type = str(obj.type) || "Opaque";
  if (type === "kubernetes.io/tls") return <TlsSecretBody obj={obj} />;
  if (type === "kubernetes.io/dockerconfigjson" || type === "kubernetes.io/dockercfg")
    return <DockerSecretBody obj={obj} />;
  return <GeneralSecretBody obj={obj} />;
}

function ConfigBody({ obj }: { obj: K8sObject }) {
  const data = asRecord(obj.data) as Record<string, string>;
  const keys = Object.keys(data);
  return (
    <Section title={`Data (${plural(keys.length, "key")})`}>
      {keys.length === 0 ? (
        <span className="fl-detail-empty">No data</span>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map((k) => (
            <ConfigDataEntry key={k} name={k} value={str(data[k])} secret={false} />
          ))}
        </div>
      )}
    </Section>
  );
}

function PvcBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const phase = str(status.phase);
  return (
    <Section title="Volume">
      <KV
        pairs={[
          ["Status", <StatusPill key="s" status={phase || "—"} kind={phaseKind(phase)} />],
          ["Capacity", str(asRecord(status.capacity).storage)],
          ["Access modes", asArray(spec.accessModes).map(str).join(", ")],
          [
            "Storage class",
            spec.storageClassName ? (
              <ResourceLink
                target={{ kind: "StorageClass", namespace: null, name: str(spec.storageClassName) }}
                onOpenResource={onOpenResource}
              />
            ) : (
              ""
            ),
          ],
          [
            "Volume",
            spec.volumeName ? (
              <ResourceLink
                target={{ kind: "PersistentVolume", namespace: null, name: str(spec.volumeName) }}
                onOpenResource={onOpenResource}
              />
            ) : (
              ""
            ),
          ],
        ]}
      />
    </Section>
  );
}

function PersistentVolumeBody({
  obj,
  onOpenResource,
}: {
  obj: K8sObject;
  onOpenResource?: OpenResource;
}) {
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const claim = asRecord(spec.claimRef);
  const phase = str(status.phase);
  const sourceType = Object.keys(spec).find((key) => PERSISTENT_VOLUME_SOURCE_TYPES.has(key)) ?? "";
  return (
    <Section title="Persistent Volume">
      <KV
        pairs={[
          ["Status", <StatusPill key="s" status={phase || "—"} kind={phaseKind(phase)} />],
          ["Capacity", str(asRecord(spec.capacity).storage)],
          ["Access modes", asArray(spec.accessModes).map(str).join(", ")],
          ["Reclaim policy", str(spec.persistentVolumeReclaimPolicy)],
          ["Volume mode", str(spec.volumeMode)],
          ["Source", sourceType ? VOLUME_TYPE_LABELS[sourceType] ?? sourceType : ""],
          [
            "Storage class",
            spec.storageClassName ? (
              <ResourceLink
                target={{ kind: "StorageClass", namespace: null, name: str(spec.storageClassName) }}
                onOpenResource={onOpenResource}
              />
            ) : (
              ""
            ),
          ],
          [
            "Claim",
            claim.name ? (
              <ResourceLink
                target={{
                  kind: "PersistentVolumeClaim",
                  namespace: str(claim.namespace) || null,
                  name: str(claim.name),
                }}
                onOpenResource={onOpenResource}
              />
            ) : (
              ""
            ),
          ],
        ]}
      />
    </Section>
  );
}

interface IngressPathRow {
  key: string;
  host: string;
  path: string;
  backend: string;
}

function IngressBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const spec = asRecord(obj.spec);
  const namespace = str(asRecord(obj.metadata).namespace) || null;
  const rows: IngressPathRow[] = [];
  asArray(spec.rules).forEach((r, ri) => {
    const rr = asRecord(r);
    const host = str(rr.host) || "*";
    asArray(asRecord(rr.http).paths).forEach((p, pi) => {
      const pp = asRecord(p);
      const svc = asRecord(asRecord(pp.backend).service);
      const port = asRecord(svc.port);
      rows.push({
        key: `${ri}-${pi}`,
        host,
        path: str(pp.path) || "/",
        backend: `${str(svc.name)}:${str(port.number) || str(port.name)}`,
      });
    });
  });
  const cols: Column<IngressPathRow>[] = [
    { key: "host", header: "Host", render: (r) => <span className="fl-mono">{r.host}</span> },
    { key: "path", header: "Path", render: (r) => <span className="fl-mono">{r.path}</span> },
    {
      key: "backend",
      header: "Backend",
      render: (r) => {
        const serviceName = r.backend.split(":", 1)[0];
        return (
          <ResourceLink
            target={{ kind: "Service", namespace, name: serviceName }}
            onOpenResource={onOpenResource}
          >
            {r.backend}
          </ResourceLink>
        );
      },
    },
  ];
  const tls = asArray(spec.tls).flatMap((t) => asArray(asRecord(t).hosts).map(str));
  const tlsSecrets = asArray(spec.tls).map((t) => str(asRecord(t).secretName)).filter(Boolean);
  return (
    <>
      <Section title="Ingress">
        <KV
          pairs={[
            ["Class", str(spec.ingressClassName)],
            ["TLS hosts", tls.length ? tls.join(", ") : ""],
            [
              "TLS secrets",
              tlsSecrets.length ? (
                <LinkedResources
                  targets={tlsSecrets.map((name) => ({ kind: "Secret", namespace, name }))}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
          ]}
        />
      </Section>
      {rows.length > 0 && (
        <Section title="Rules">
          <Table columns={cols} data={rows} getRowKey={(r) => r.key} />
        </Section>
      )}
    </>
  );
}

function HpaBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const target = asRecord(spec.scaleTargetRef);
  const namespace = str(asRecord(obj.metadata).namespace) || null;
  return (
    <Section title="Autoscaler">
      <KV
        pairs={[
          [
            "Scale target",
            target.name ? (
              <ResourceLink
                target={{ kind: str(target.kind), namespace, name: str(target.name) }}
                onOpenResource={onOpenResource}
              >
                {str(target.kind)}/{str(target.name)}
              </ResourceLink>
            ) : (
              ""
            ),
          ],
          [
            "Replicas",
            `${str(status.currentReplicas) || "?"} current / ${str(status.desiredReplicas) || "?"} desired`,
          ],
          ["Min replicas", str(spec.minReplicas)],
          ["Max replicas", str(spec.maxReplicas)],
        ]}
      />
    </Section>
  );
}

interface QuotaRow {
  key: string;
  resource: string;
  used: string;
  hard: string;
}

function ResourceQuotaBody({ obj }: { obj: K8sObject }) {
  const status = asRecord(obj.status);
  const hard = asRecord(status.hard);
  const used = asRecord(status.used);
  const rows: QuotaRow[] = Object.keys(hard).map((k) => ({
    key: k,
    resource: k,
    used: str(used[k]),
    hard: str(hard[k]),
  }));
  const cols: Column<QuotaRow>[] = [
    { key: "resource", header: "Resource", render: (r) => <span className="fl-mono">{r.resource}</span> },
    { key: "used", header: "Used", render: (r) => r.used },
    { key: "hard", header: "Hard", render: (r) => r.hard },
  ];
  return (
    <Section title="Quota">
      {rows.length ? (
        <Table columns={cols} data={rows} getRowKey={(r) => r.key} />
      ) : (
        <span className="fl-detail-empty">No quota</span>
      )}
    </Section>
  );
}

function PdbBody({ obj }: { obj: K8sObject }) {
  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  return (
    <Section title="Disruption Budget">
      <KV
        pairs={[
          ["Min available", str(spec.minAvailable)],
          ["Max unavailable", str(spec.maxUnavailable)],
          ["Healthy", `${str(status.currentHealthy)} / ${str(status.desiredHealthy)}`],
          ["Disruptions allowed", str(status.disruptionsAllowed)],
        ]}
      />
    </Section>
  );
}

function NetworkPolicyBody({ obj }: { obj: K8sObject }) {
  const spec = asRecord(obj.spec);
  const sel = asRecord(asRecord(spec.podSelector).matchLabels) as Record<string, string>;
  return (
    <Section title="Network Policy">
      <KV
        pairs={[
          ["Pod selector", Object.keys(sel).length ? <Chips key="s" map={sel} /> : "all pods"],
          ["Policy types", asArray(spec.policyTypes).map(str).join(", ")],
          ["Ingress rules", str(asArray(spec.ingress).length)],
          ["Egress rules", str(asArray(spec.egress).length)],
        ]}
      />
    </Section>
  );
}

function ServiceAccountBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const secrets = asArray(obj.secrets).map((s) => str(asRecord(s).name)).filter(Boolean);
  const pull = asArray(obj.imagePullSecrets).map((s) => str(asRecord(s).name)).filter(Boolean);
  const namespace = str(asRecord(obj.metadata).namespace) || null;
  return (
    <Section title="Service Account">
      <KV
        pairs={[
          [
            "Secrets",
            secrets.length ? (
              <LinkedResources
                targets={secrets.map((name) => ({ kind: "Secret", namespace, name }))}
                onOpenResource={onOpenResource}
              />
            ) : (
              ""
            ),
          ],
          [
            "Image pull secrets",
            pull.length ? (
              <LinkedResources
                targets={pull.map((name) => ({ kind: "Secret", namespace, name }))}
                onOpenResource={onOpenResource}
              />
            ) : (
              ""
            ),
          ],
          ["Automount token", obj.automountServiceAccountToken === false ? "No" : "Yes"],
        ]}
      />
    </Section>
  );
}

function portText2(p: Record<string, unknown>): string {
  const name = str(p.name);
  return `${name ? `${name}: ` : ""}${str(p.port)}/${str(p.protocol) || "TCP"}`;
}

function EndpointsBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const addrs: string[] = [];
  const ports: string[] = [];
  const namespace = str(asRecord(obj.metadata).namespace) || null;
  const targets: ResourceTarget[] = [];
  asArray(obj.subsets).forEach((s) => {
    const ss = asRecord(s);
    [...asArray(ss.addresses), ...asArray(ss.notReadyAddresses)].forEach((a) => {
      const address = asRecord(a);
      addrs.push(str(address.ip));
      const target = asRecord(address.targetRef);
      if (target.name) {
        const kind = str(target.kind);
        targets.push({
          kind,
          namespace: targetNamespace(kind, str(target.namespace) || namespace),
          name: str(target.name),
        });
      }
    });
    asArray(ss.ports).forEach((p) => ports.push(portText2(asRecord(p))));
  });
  return (
    <Section title="Endpoints">
      <KV
        pairs={[
          ["Addresses", addrs.length ? <PlainChips key="a" items={addrs} /> : "None"],
          ["Ports", ports.length ? <PlainChips key="p" items={ports} /> : ""],
          [
            "Targets",
            targets.length ? (
              <LinkedResources targets={targets} onOpenResource={onOpenResource} />
            ) : (
              ""
            ),
          ],
        ]}
      />
    </Section>
  );
}

function EndpointSliceBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const addrs = asArray(obj.endpoints).flatMap((e) => asArray(asRecord(e).addresses).map(str));
  const ports = asArray(obj.ports).map((p) => portText2(asRecord(p)));
  const namespace = str(asRecord(obj.metadata).namespace) || null;
  const targets = asArray(obj.endpoints).flatMap((endpoint): ResourceTarget[] => {
    const target = asRecord(asRecord(endpoint).targetRef);
    if (!target.name) return [];
    const kind = str(target.kind);
    return [{
      kind,
      namespace: targetNamespace(kind, str(target.namespace) || namespace),
      name: str(target.name),
    }];
  });
  return (
    <Section title="Endpoint Slice">
      <KV
        pairs={[
          ["Address type", str(obj.addressType)],
          ["Addresses", addrs.length ? <PlainChips key="a" items={addrs} /> : "None"],
          ["Ports", ports.length ? <PlainChips key="p" items={ports} /> : ""],
          [
            "Targets",
            targets.length ? (
              <LinkedResources targets={targets} onOpenResource={onOpenResource} />
            ) : (
              ""
            ),
          ],
        ]}
      />
    </Section>
  );
}

interface RuleRow {
  key: string;
  apiGroups: string;
  resources: string;
  verbs: string;
}

function RoleBody({ obj }: { obj: K8sObject }) {
  const rows: RuleRow[] = asArray(obj.rules).map((r, i) => {
    const rr = asRecord(r);
    return {
      key: String(i),
      apiGroups: asArray(rr.apiGroups).map((g) => str(g) || "*").join(", ") || "*",
      resources: asArray(rr.resources).map(str).join(", "),
      verbs: asArray(rr.verbs).map(str).join(", "),
    };
  });
  const cols: Column<RuleRow>[] = [
    { key: "apiGroups", header: "API Groups", render: (r) => <span className="fl-mono">{r.apiGroups}</span> },
    { key: "resources", header: "Resources", render: (r) => <span className="fl-mono">{r.resources}</span> },
    { key: "verbs", header: "Verbs", render: (r) => <span className="fl-mono">{r.verbs}</span> },
  ];
  return (
    <Section title={`Rules (${rows.length})`}>
      {rows.length ? (
        <Table columns={cols} data={rows} getRowKey={(r) => r.key} />
      ) : (
        <span className="fl-detail-empty">No rules</span>
      )}
    </Section>
  );
}

interface SubjectRow {
  key: string;
  kind: string;
  name: string;
  namespace: string;
}

function RoleBindingBody({ obj, onOpenResource }: { obj: K8sObject; onOpenResource?: OpenResource }) {
  const roleRef = asRecord(obj.roleRef);
  const bindingNamespace = str(asRecord(obj.metadata).namespace) || null;
  const subjects: SubjectRow[] = asArray(obj.subjects).map((s, i) => {
    const ss = asRecord(s);
    return { key: String(i), kind: str(ss.kind), name: str(ss.name), namespace: str(ss.namespace) };
  });
  const cols: Column<SubjectRow>[] = [
    { key: "kind", header: "Kind", render: (r) => r.kind },
    {
      key: "name",
      header: "Name",
      render: (r) =>
        r.kind === "ServiceAccount" ? (
          <ResourceLink
            target={{ kind: r.kind, namespace: r.namespace || bindingNamespace, name: r.name }}
            onOpenResource={onOpenResource}
          />
        ) : (
          <span className="fl-mono">{r.name}</span>
        ),
    },
    { key: "namespace", header: "Namespace", render: (r) => <span className="fl-mono">{r.namespace || "—"}</span> },
  ];
  return (
    <>
      <Section title="Role Ref">
        <KV
          pairs={[
            ["Kind", str(roleRef.kind)],
            [
              "Name",
              <ResourceLink
                key="n"
                target={{
                  kind: str(roleRef.kind),
                  namespace: targetNamespace(str(roleRef.kind), bindingNamespace),
                  name: str(roleRef.name),
                }}
                onOpenResource={onOpenResource}
              />,
            ],
          ]}
        />
      </Section>
      {subjects.length > 0 && (
        <Section title={`Subjects (${subjects.length})`}>
          <Table columns={cols} data={subjects} getRowKey={(r) => r.key} />
        </Section>
      )}
    </>
  );
}

function PriorityClassBody({ obj }: { obj: K8sObject }) {
  return (
    <Section title="Priority Class">
      <KV
        pairs={[
          ["Value", str(obj.value)],
          ["Global default", obj.globalDefault === true ? "Yes" : "No"],
          ["Preemption policy", str(obj.preemptionPolicy)],
        ]}
      />
    </Section>
  );
}

function StorageClassBody({ obj }: { obj: K8sObject }) {
  return (
    <Section title="Storage Class">
      <KV
        pairs={[
          ["Provisioner", <span key="p" className="fl-mono">{str(obj.provisioner)}</span>],
          ["Reclaim policy", str(obj.reclaimPolicy)],
          ["Volume binding mode", str(obj.volumeBindingMode)],
          ["Allow expansion", obj.allowVolumeExpansion === true ? "Yes" : "No"],
        ]}
      />
    </Section>
  );
}

function RuntimeClassBody({ obj }: { obj: K8sObject }) {
  return (
    <Section title="Runtime Class">
      <KV pairs={[["Handler", <span key="h" className="fl-mono">{str(obj.handler)}</span>]]} />
    </Section>
  );
}

function IngressClassBody({ obj }: { obj: K8sObject }) {
  const spec = asRecord(obj.spec);
  return (
    <Section title="Ingress Class">
      <KV pairs={[["Controller", <span key="c" className="fl-mono">{str(spec.controller)}</span>]]} />
    </Section>
  );
}

function LimitRangeBody({ obj }: { obj: K8sObject }) {
  const limits = asArray(asRecord(obj.spec).limits);
  return (
    <Section title={`Limits (${limits.length})`}>
      {limits.length ? (
        <KV
          pairs={limits.map((l, i) => {
            const ll = asRecord(l);
            const constraints = Object.keys({
              ...asRecord(ll.default),
              ...asRecord(ll.max),
              ...asRecord(ll.min),
            });
            return [str(ll.type) || `Limit ${i + 1}`, constraints.join(", ") || "—"] as Pair;
          })}
        />
      ) : (
        <span className="fl-detail-empty">None</span>
      )}
    </Section>
  );
}

function LeaseBody({ obj }: { obj: K8sObject }) {
  const spec = asRecord(obj.spec);
  const renew = str(spec.renewTime);
  return (
    <Section title="Lease">
      <KV
        pairs={[
          ["Holder", <span key="h" className="fl-mono">{str(spec.holderIdentity)}</span>],
          ["Duration", spec.leaseDurationSeconds != null ? `${str(spec.leaseDurationSeconds)}s` : ""],
          ["Renewed", renew ? `${ageFromTimestamp(renew)} ago` : ""],
        ]}
      />
    </Section>
  );
}

function WebhookBody({ obj }: { obj: K8sObject }) {
  const webhooks = asArray(obj.webhooks).map((w) => str(asRecord(w).name)).filter(Boolean);
  return (
    <Section title={`Webhooks (${webhooks.length})`}>
      {webhooks.length ? (
        <PlainChips items={webhooks} />
      ) : (
        <span className="fl-detail-empty">None</span>
      )}
    </Section>
  );
}

function KindBody({
  kind,
  obj,
  context = "",
  onOpenResource,
}: {
  kind: string;
  obj: K8sObject;
  context?: string;
  onOpenResource?: OpenResource;
}) {
  switch (kind) {
    case "DaemonSet":
      return <DaemonSetBody obj={obj} />;
    case "Service":
      return <ServiceBody obj={obj} context={context} />;
    case "Node":
      return <NodeBody obj={obj} />;
    case "Job":
      return <JobBody obj={obj} />;
    case "CronJob":
      return <CronJobBody obj={obj} onOpenResource={onOpenResource} />;
    case "ConfigMap":
      return <ConfigBody obj={obj} />;
    case "Secret":
      return <SecretBody obj={obj} />;
    case "PersistentVolumeClaim":
      return <PvcBody obj={obj} onOpenResource={onOpenResource} />;
    case "PersistentVolume":
      return <PersistentVolumeBody obj={obj} onOpenResource={onOpenResource} />;
    case "Ingress":
      return <IngressBody obj={obj} onOpenResource={onOpenResource} />;
    case "HorizontalPodAutoscaler":
      return <HpaBody obj={obj} onOpenResource={onOpenResource} />;
    case "ResourceQuota":
      return <ResourceQuotaBody obj={obj} />;
    case "PodDisruptionBudget":
      return <PdbBody obj={obj} />;
    case "NetworkPolicy":
      return <NetworkPolicyBody obj={obj} />;
    case "ServiceAccount":
      return <ServiceAccountBody obj={obj} onOpenResource={onOpenResource} />;
    case "Endpoints":
      return <EndpointsBody obj={obj} onOpenResource={onOpenResource} />;
    case "EndpointSlice":
      return <EndpointSliceBody obj={obj} onOpenResource={onOpenResource} />;
    case "Role":
    case "ClusterRole":
      return <RoleBody obj={obj} />;
    case "RoleBinding":
    case "ClusterRoleBinding":
      return <RoleBindingBody obj={obj} onOpenResource={onOpenResource} />;
    case "PriorityClass":
      return <PriorityClassBody obj={obj} />;
    case "StorageClass":
      return <StorageClassBody obj={obj} />;
    case "RuntimeClass":
      return <RuntimeClassBody obj={obj} />;
    case "IngressClass":
      return <IngressClassBody obj={obj} />;
    case "LimitRange":
      return <LimitRangeBody obj={obj} />;
    case "Lease":
      return <LeaseBody obj={obj} />;
    case "MutatingWebhookConfiguration":
    case "ValidatingWebhookConfiguration":
      return <WebhookBody obj={obj} />;
    default:
      return null;
  }
}

function relatedPodSelector(kind: string, obj: K8sObject): Record<string, string> {
  const spec = asRecord(obj.spec);
  switch (kind) {
    case "Service":
      return asRecord(spec.selector) as Record<string, string>;
    case "DaemonSet":
    case "Job":
      return asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
    case "PodDisruptionBudget":
      return asRecord(asRecord(spec.selector).matchLabels) as Record<string, string>;
    case "NetworkPolicy":
      return asRecord(asRecord(spec.podSelector).matchLabels) as Record<string, string>;
    default:
      return {};
  }
}

/** Generic detail layout for non-Pod kinds: metadata + kind body + conditions. */
function GenericDetail({
  kind,
  obj,
  now,
  context = "",
  onOpenResource,
}: {
  kind: string;
  obj: K8sObject;
  now: number;
  context?: string;
  onOpenResource?: OpenResource;
}) {
  const meta = asRecord(obj.metadata);
  const namespace = str(meta.namespace) || null;
  const owners = asArray(meta.ownerReferences).map((o) => {
    const or = asRecord(o);
    const kind = str(or.kind);
    return { kind, name: str(or.name), namespace: targetNamespace(kind, namespace) };
  }).filter((target) => target.kind && target.name);
  const conditions = asArray(asRecord(obj.status).conditions) as unknown as Condition[];
  const created = str(meta.creationTimestamp);
  const podSelector = relatedPodSelector(kind, obj);

  return (
    <div className="fl-detail">
      <Section title="Metadata">
        <KV
          pairs={[
            ["Name", <span className="fl-mono">{str(meta.name)}</span>],
            [
              "Namespace",
              meta.namespace ? (
                <ResourceLink
                  target={{ kind: "Namespace", namespace: null, name: str(meta.namespace) }}
                  onOpenResource={onOpenResource}
                />
              ) : (
                ""
              ),
            ],
            ["Created", created ? `${ageFromTimestamp(created, now)} ago (${absoluteTimestamp(created)})` : ""],
            [
              "Controlled by",
              owners.length ? (
                <LinkedResources targets={owners} onOpenResource={onOpenResource} />
              ) : (
                ""
              ),
            ],
          ]}
        />
        <div className="fl-detail-subhead">Labels</div>
        <Chips map={meta.labels as Record<string, string>} />
        <div className="fl-detail-subhead">Annotations</div>
        <Chips map={meta.annotations as Record<string, string>} />
      </Section>

      <KindBody kind={kind} obj={obj} context={context} onOpenResource={onOpenResource} />

      {context && namespace && Object.keys(podSelector).length > 0 && (
        <ManagedPods
          context={context}
          namespace={namespace}
          selector={podSelector}
          onOpenResource={onOpenResource}
        />
      )}

      <ConditionsTable conditions={conditions} now={now} />
    </div>
  );
}

/** Render the structured detail of a fetched object. Exported for testing. */
export function ObjectDetail({
  kind,
  obj,
  now,
  context = "",
  onOpenResource,
}: {
  kind: string;
  obj: K8sObject;
  now: number;
  context?: string;
  onOpenResource?: OpenResource;
}) {
  const meta = asRecord(obj.metadata);
  // Metrics chart (Pod/Node) sits above the rest, matching Lens. Needs a
  // context to poll; in tests without one it's simply omitted.
  const metrics =
    context && (kind === "Pod" || kind === "Node") ? (
      <MetricsPanel
        kind={kind}
        context={context}
        namespace={str(meta.namespace) || null}
        name={str(meta.name)}
      />
    ) : null;

  if (kind === "Pod")
    return (
      <>
        {metrics}
        <PodDetailView
          obj={obj}
          now={now}
          context={context}
          onOpenResource={onOpenResource}
        />
      </>
    );
  if (kind === "Deployment" || kind === "StatefulSet" || kind === "ReplicaSet")
    return (
      <WorkloadDetailView
        kind={kind}
        obj={obj}
        now={now}
        context={context}
        onOpenResource={onOpenResource}
      />
    );
  return (
    <>
      {metrics}
      <GenericDetail
        kind={kind}
        obj={obj}
        now={now}
        context={context}
        onOpenResource={onOpenResource}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the overview (data loader)                                          */
/* ------------------------------------------------------------------ */

/**
 * Structured detail panel for a resource. Fetches the object via `k8s.getObject`
 * and renders metadata, status, and kind-specific sections. `getObjectFn` is
 * injectable for testing.
 */
export function ResourceOverview({
  context,
  kind,
  namespace,
  name,
  getObjectFn = getObject,
  onOpenResource,
}: {
  context: string;
  kind: string;
  namespace: string | null;
  name: string;
  getObjectFn?: typeof getObject;
  onOpenResource?: OpenResource;
}) {
  const [obj, setObj] = useState<K8sObject | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setObj(null);
    setError("");
    void getObjectFn(context, kind, namespace, name).then((out) => {
      if (!active) return;
      if (out.error) setError(out.error);
      else setObj(out.object ?? {});
    });
    return () => {
      active = false;
    };
  }, [context, kind, namespace, name, getObjectFn]);

  if (error) return <p style={{ color: "var(--fl-color-danger)" }}>Error: {error}</p>;
  if (obj === null) return <Spinner label="Loading details" />;
  return (
    <ObjectDetail
      kind={kind}
      obj={obj}
      now={Date.now()}
      context={context}
      onOpenResource={onOpenResource}
    />
  );
}
