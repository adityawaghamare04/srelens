import type { ReactNode } from "react";
import {
  ageFromTimestamp,
  asArray,
  asRecord,
  containerLastRestartTime,
  containerStateText,
  envText,
  latestRestartTime,
  mountText,
  orderPodConditions,
  portText,
  probeChips,
  resourceStatusLine,
  resourceText,
  str,
  summarizeAffinity,
  timestampWithAge,
  tolerationText,
  type Condition,
  type K8sObject,
} from "@srelens/core";
import {
  EmptyState,
  KV,
  PairList,
  Section,
  StatusPill,
  SubHead,
  Table,
  type Column,
} from "@srelens/ui-kit";
import { AnnotationsSection, ConditionsSection, LabelsSection, StringList } from "./sections";

/**
 * Kubernetes' own labels for a pod volume's source kind, keyed on which field
 * of the volume (besides `name`) is actually set — matches classic's own
 * table (`VOLUME_TYPE_LABELS` in `ResourceOverview.tsx`).
 */
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


/**
 * What a pod volume points at, as plain text — "PersistentVolumeClaim/data",
 * a host path, an NFS export, the CSI driver, or the config maps/secrets a
 * projected volume merges. Classic renders these through `ResourceLink`,
 * which navigates; nothing here can, since `PaneBody` has no navigation
 * contract yet (see the task report), so the same facts are shown inert —
 * still named, just not clickable.
 */
function volumeSourceText(volume: Record<string, unknown>): string {
  const pvc = asRecord(volume.persistentVolumeClaim);
  if (pvc.claimName) return `PersistentVolumeClaim/${str(pvc.claimName)}`;
  const configMap = asRecord(volume.configMap);
  if (configMap.name) return `ConfigMap/${str(configMap.name)}`;
  const secret = asRecord(volume.secret);
  if (secret.secretName) return `Secret/${str(secret.secretName)}`;
  if (volume.hostPath) return str(asRecord(volume.hostPath).path);
  if (volume.nfs) {
    const nfs = asRecord(volume.nfs);
    return `${str(nfs.server)}:${str(nfs.path)}`;
  }
  if (volume.csi) return str(asRecord(volume.csi).driver);
  if (volume.projected) {
    const sources = asArray(asRecord(volume.projected).sources).map(asRecord);
    const names = sources.flatMap((source) => {
      const projectedConfigMap = asRecord(source.configMap);
      if (projectedConfigMap.name) return [`ConfigMap/${str(projectedConfigMap.name)}`];
      const projectedSecret = asRecord(source.secret);
      if (projectedSecret.name) return [`Secret/${str(projectedSecret.name)}`];
      return [];
    });
    return names.length > 0 ? names.join(", ") : `${sources.length} projected sources`;
  }
  if (volume.emptyDir) return str(asRecord(volume.emptyDir).medium) || "Node temporary storage";
  return "—";
}

function volumeTypeLabel(volume: Record<string, unknown>): string {
  const type = Object.keys(volume).find((key) => key !== "name") ?? "unknown";
  return VOLUME_TYPE_LABELS[type] ?? type;
}

/** The images a pod runs, each named once however many containers share it. */
function imagesOf(containers: unknown): string[] {
  return [...new Set(asArray(containers).map((c) => str(asRecord(c).image)).filter(Boolean))];
}

/** One image reads as a fact; several read as a list. */
function ImageValue({ images }: { images: string[] }) {
  return images.length === 1 ? <span className="font-mono">{images[0]}</span> : <StringList items={images} />;
}

/**
 * The pod's facts, in the order the design's own Pod frame reads them:
 * Status, Node, Pod IP, QoS class, Service account, Containers ready,
 * Restarts, Controlled by, Created, Image.
 *
 * No heading. The design heads the first block of a detail with nothing — the
 * pane's header has already given the name, the kind and the namespace — and
 * no `Name` row either, which repeated that header verbatim.
 *
 * The frame's ten facts are not everything srelens knows, and the extras it
 * carries over from classic (Pod IPs, Priority class, Runtime class, Image
 * pull secrets, Last restart) stay: the frame is a design, not a schema. They
 * sit beside their own kin rather than in a heap at the end, so the reading
 * order the frame set survives them.
 *
 * `Image` is new here. It used to live only on the Containers pane, which
 * meant the one question asked of a pod more often than any other — what is
 * it running — took a tab change to answer.
 *
 * The status word comes from core's `resourceStatusLine`, the same reading the
 * pane's header and the list row use. Nothing here derives a second opinion:
 * a pod whose container sits in `CrashLoopBackOff` still reports phase
 * "Running", so a fact list reading `status.phase` by itself would print
 * "Running" under a header saying "CrashLoopBackOff".
 *
 * Namespace, Node, Service account, Priority class, Runtime class, Controlled
 * by and Image pull secrets are `ResourceLink`s in classic that navigate;
 * they render here as plain text (see the task report for the full list).
 */
function FactsSection({ object }: { object: K8sObject }) {
  const meta = object.metadata ?? {};
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const owners = meta.ownerReferences ?? [];
  const podIPs = asArray(status.podIPs)
    .map((p) => str(asRecord(p).ip))
    .filter(Boolean);
  const imagePullSecrets = asArray(spec.imagePullSecrets)
    .map((secret) => str(asRecord(secret).name))
    .filter(Boolean);
  const containerStatuses = asArray(status.containerStatuses).map(asRecord);
  const allContainerStatuses = [
    ...asArray(status.initContainerStatuses).map(asRecord),
    ...containerStatuses,
    ...asArray(status.ephemeralContainerStatuses).map(asRecord),
  ];
  const podRestartCount = allContainerStatuses.reduce(
    (total, containerStatus) => total + Number(containerStatus.restartCount ?? 0),
    0,
  );
  const podLastRestart = latestRestartTime(allContainerStatuses);
  const containersReady = containerStatuses.filter((c) => c.ready === true).length;
  const created = str(meta.creationTimestamp);
  const nodeName = str(spec.nodeName);
  const podIP = str(status.podIP);
  const serviceAccountName = str(spec.serviceAccountName);
  const priorityClassName = str(spec.priorityClassName);
  const runtimeClassName = str(spec.runtimeClassName);
  const qosClass = str(status.qosClass);
  const images = imagesOf(spec.containers);
  const statusLine = resourceStatusLine("Pod", object);

  return (
    <Section>
      {statusLine && (
        <KV k="Status" v={<StatusPill status={statusLine.status} kind={statusLine.health} tinted />} />
      )}
      {nodeName && <KV k="Node" v={nodeName} mono />}
      {podIP && <KV k="Pod IP" v={podIP} mono />}
      {podIPs.length > 0 && <KV k="Pod IPs" v={<StringList items={podIPs} />} />}
      {qosClass && <KV k="QoS class" v={qosClass} />}
      {serviceAccountName && <KV k="Service account" v={serviceAccountName} mono />}
      {priorityClassName && <KV k="Priority class" v={priorityClassName} mono />}
      {runtimeClassName && <KV k="Runtime class" v={runtimeClassName} mono />}
      {imagePullSecrets.length > 0 && (
        <KV
          k="Image pull secrets"
          v={<StringList items={imagePullSecrets.map((name) => `Secret/${name}`)} />}
        />
      )}
      {/* No container status at all means the kubelet has not reported yet:
          "0 of 0" and "0 restarts" would read as facts where there is only an
          absence. */}
      {containerStatuses.length > 0 && (
        <KV k="Containers ready" v={`${containersReady} of ${containerStatuses.length}`} />
      )}
      {allContainerStatuses.length > 0 && <KV k="Restarts" v={str(podRestartCount)} />}
      {podLastRestart && <KV k="Last restart" v={timestampWithAge(podLastRestart, Date.now())} />}
      {owners.length > 0 && (
        <KV k="Controlled by" v={<StringList items={owners.map((o) => `${o.kind}/${o.name}`)} />} />
      )}
      {meta.namespace && <KV k="Namespace" v={str(meta.namespace)} mono />}
      {created && <KV k="Created" v={`${ageFromTimestamp(created, Date.now())} ago`} />}
      {images.length > 0 && <KV k="Image" v={<ImageValue images={images} />} />}
    </Section>
  );
}

/**
 * Where and how the pod is placed — classic's "Scheduling" section, shown
 * only when there is something to say (a node, a selector, an affinity rule
 * or a toleration), same as classic's `hasScheduling` gate.
 */
function SchedulingSection({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const nodeSelector = (spec.nodeSelector ?? {}) as Record<string, string>;
  const affinityLines = summarizeAffinity(asRecord(spec.affinity));
  const tolerations = asArray(spec.tolerations);
  const hasScheduling =
    !!spec.nodeName || Object.keys(nodeSelector).length > 0 || affinityLines.length > 0 || tolerations.length > 0;

  if (!hasScheduling) return null;

  return (
    <Section title="Scheduling">
      <KV k="Node" v={spec.nodeName ? str(spec.nodeName) : "Not scheduled"} mono={!!spec.nodeName} />
      {Object.keys(nodeSelector).length > 0 && (
        <KV k="Node selector" v={<PairList pairs={Object.entries(nodeSelector)} breakValues />} />
      )}
      {affinityLines.length > 0 && <KV k="Affinity" v={<StringList items={affinityLines} />} />}
      {tolerations.length > 0 && (
        <KV k="Tolerations" v={<StringList items={tolerations.map(tolerationText)} />} />
      )}
    </Section>
  );
}

const VOLUME_COLUMNS: Column<Record<string, unknown>>[] = [
  { key: "name", header: "Name", render: (v) => <span className="font-mono">{str(v.name)}</span> },
  { key: "type", header: "Type", render: volumeTypeLabel },
  { key: "source", header: "Source", render: volumeSourceText },
];

/**
 * The pod's own volumes — classic's "Pod Volumes" table. The "Source" column
 * is one of the plain-text substitutions for a `ResourceLink`: it names the
 * PersistentVolumeClaim/ConfigMap/Secret a volume points at without being
 * able to open it (see the task report).
 */
function PodVolumesSection({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const volumes = asArray(spec.volumes).map(asRecord);
  if (volumes.length === 0) return null;
  return (
    <Section title="Pod Volumes">
      <Table columns={VOLUME_COLUMNS} data={volumes} getRowKey={(v) => str(v.name)} />
    </Section>
  );
}



/**
 * A pod's Details pane, as a flat run of blocks divided by hairline rules —
 * the facts, then Scheduling and Pod Volumes, then Conditions, Labels and
 * Annotations.
 *
 * Every block is a sibling of every other, with nothing wrapped around any of
 * them: `.section + .section` is what draws the rule between two blocks, so a
 * div — or a bare `LoadingState` — between two of them quietly removes the
 * rule on both sides. A block with nothing to say renders nothing at all, and
 * the rules land in the right places on their own.
 *
 * Conditions, Labels and Annotations close the pane rather than following the
 * facts immediately as the design frame draws them. The frame has no
 * Scheduling or Volumes block to place, and `GenericBody` already ends every
 * other kind's Details this way — so a reader moving between kinds finds the
 * same three blocks in the same place.
 *
 * The container list lives on the Containers pane instead
 * (`PodContainersBody`, below), which is what `panes.containers` exists for.
 */
export function PodDetailsBody({ object }: { object: K8sObject }) {
  const meta = object.metadata ?? {};
  const status = asRecord(object.status);
  const conditions = asArray(status.conditions) as unknown as Condition[];

  const sections: ReactNode[] = [
    <FactsSection key="facts" object={object} />,
    <SchedulingSection key="scheduling" object={object} />,
    <PodVolumesSection key="volumes" object={object} />,
    <ConditionsSection key="conditions" conditions={orderPodConditions(conditions)} />,
    <LabelsSection key="labels" labels={meta.labels ?? {}} />,
    <AnnotationsSection key="annotations" kind="Pod" annotations={meta.annotations ?? {}} />,
  ];

  return <>{sections}</>;
}

/**
 * One container's block — app, init or ephemeral. State and restart count come
 * from its `containerStatuses` entry (absent while the pod is still being
 * scheduled, e.g. an init container that hasn't started); ports, probes,
 * environment and mounts come from the spec and are omitted outright, not
 * shown empty, when the container has none.
 *
 * "Last restart" and "Running since" are distinct facts, not one shown two
 * ways: `containerLastRestartTime` reads `lastState` (the PREVIOUS run's
 * termination), `runningSince` reads `state.running.startedAt` (when the
 * CURRENT run began) — a reader diagnosing a crash loop needs both.
 * "Debugging" (`targetContainerName`) only appears on an ephemeral
 * container, naming which container its debug session is attached to.
 */
function ContainerCard({
  container,
  status,
}: {
  container: Record<string, unknown>;
  status?: Record<string, unknown>;
}) {
  const name = str(container.name);
  const state = status ? containerStateText(status) : undefined;
  const targetContainerName = str(container.targetContainerName);
  const restarts = status?.restartCount;
  const lastRestart = status ? containerLastRestartTime(status) : "";
  const runningSince = status ? str(asRecord(asRecord(status.state).running).startedAt) : "";
  const image = str(container.image);
  const ports = asArray(container.ports).map(asRecord);
  const env = asArray(container.env);
  const mounts = asArray(container.volumeMounts);
  const resources = asRecord(container.resources);
  const requests = asRecord(resources.requests);
  const limits = asRecord(resources.limits);
  const liveness = asRecord(container.livenessProbe);
  const readiness = asRecord(container.readinessProbe);
  const startup = asRecord(container.startupProbe);
  const command = [...asArray(container.command), ...asArray(container.args)].map(str).join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <SubHead>
        <span className="flex items-center gap-2">
          {name}
          {state && <StatusPill status={state.text} kind={state.kind} tinted />}
        </span>
      </SubHead>
      {targetContainerName && <KV k="Debugging" v={targetContainerName} mono />}
      {restarts != null && <KV k="Restarts" v={str(restarts)} />}
      {lastRestart && <KV k="Last restart" v={timestampWithAge(lastRestart, Date.now())} />}
      {runningSince && <KV k="Running since" v={timestampWithAge(runningSince, Date.now())} />}
      {image && <KV k="Image" v={image} mono />}
      {ports.length > 0 && <KV k="Ports" v={<StringList items={ports.map(portText)} />} />}
      {env.length > 0 && <KV k="Environment" v={<StringList items={env.map(envText)} />} />}
      {mounts.length > 0 && <KV k="Mounts" v={<StringList items={mounts.map(mountText)} />} />}
      {Object.keys(liveness).length > 0 && <KV k="Liveness" v={<StringList items={probeChips(liveness)} />} />}
      {Object.keys(readiness).length > 0 && <KV k="Readiness" v={<StringList items={probeChips(readiness)} />} />}
      {Object.keys(startup).length > 0 && <KV k="Startup" v={<StringList items={probeChips(startup)} />} />}
      {command && <KV k="Command" v={command} mono />}
      {Object.keys(requests).length > 0 && <KV k="Requests" v={resourceText(requests)} />}
      {Object.keys(limits).length > 0 && <KV k="Limits" v={resourceText(limits)} />}
    </div>
  );
}

function ContainerGroup({
  title,
  containers,
  statuses,
}: {
  title: string;
  containers: Record<string, unknown>[];
  statuses: Map<string, Record<string, unknown>>;
}) {
  if (containers.length === 0) return null;
  return (
    <Section title={title}>
      <div className="flex flex-col gap-4">
        {containers.map((c) => (
          <ContainerCard key={str(c.name)} container={c} status={statuses.get(str(c.name))} />
        ))}
      </div>
    </Section>
  );
}

function statusesByName(list: unknown): Map<string, Record<string, unknown>> {
  return new Map(asArray(list).map((s) => [str(asRecord(s).name), asRecord(s)]));
}

/**
 * A pod's Containers pane: every container named, its runtime state and
 * restart count, its ports, probes, environment and mounts. Ported from
 * classic's `ContainerCard`/`PodDetailView` — the largest single body in
 * `ResourceOverview.tsx` — onto kit components; the interactive port-forward
 * affordance classic offers inline is not wired here, since neither ui-next
 * nor the kit has a forward dialog yet (see the task report).
 *
 * Flat blocks, like the Details pane beside it: the two panes are read in the
 * same 352px column, and a card here beside a rule there is two answers to
 * one question.
 */
export function PodContainersBody({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const containers = asArray(spec.containers).map(asRecord);
  const initContainers = asArray(spec.initContainers).map(asRecord);
  const ephemeralContainers = asArray(spec.ephemeralContainers).map(asRecord);

  if (containers.length === 0 && initContainers.length === 0 && ephemeralContainers.length === 0) {
    return <EmptyState title="No containers" />;
  }

  const containerStatuses = statusesByName(status.containerStatuses);

  return (
    <>
      <ContainerGroup
        title="Init containers"
        containers={initContainers}
        statuses={statusesByName(status.initContainerStatuses)}
      />
      <Section title="Containers">
        {containers.length === 0 ? (
          <EmptyState title="No containers" />
        ) : (
          <div className="flex flex-col gap-4">
            {containers.map((c) => (
              <ContainerCard key={str(c.name)} container={c} status={containerStatuses.get(str(c.name))} />
            ))}
          </div>
        )}
      </Section>
      <ContainerGroup
        title="Ephemeral containers"
        containers={ephemeralContainers}
        statuses={statusesByName(status.ephemeralContainerStatuses)}
      />
    </>
  );
}
