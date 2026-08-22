import {
  absoluteTimestamp,
  ageFromTimestamp,
  asArray,
  asRecord,
  conditionKind,
  containerLastRestartTime,
  containerStateText,
  envText,
  mountText,
  orderPodConditions,
  portText,
  probeChips,
  resourceText,
  str,
  timestampWithAge,
  type Condition,
  type K8sObject,
} from "@srelens/core";
import { EmptyState, KV, Panel, StatusPill, SubHead } from "@srelens/ui-kit";

/**
 * A pod's Details pane: the lifecycle conditions timeline, in the order
 * `orderPodConditions` gives (PodScheduled → Initialized → ContainersReady →
 * Ready, then anything else in its original order) — not the order the API
 * happened to return them. The container list lives on the Containers pane
 * instead (`PodContainersBody`, below), which is what `panes.containers`
 * exists for.
 */
export function PodDetailsBody({ object }: { object: K8sObject }) {
  const status = asRecord(object.status);
  const conditions = asArray(status.conditions) as unknown as Condition[];

  if (conditions.length === 0) {
    return <EmptyState title="No conditions" />;
  }

  return (
    <Panel title="Conditions">
      <ol className="flex flex-col gap-2">
        {orderPodConditions(conditions).map((condition) => (
          <li key={condition.type} className="flex items-center justify-between gap-3">
            <span>
              {condition.type}
              {condition.reason && condition.reason !== condition.type && (
                <span className="text-muted"> · {condition.reason}</span>
              )}
            </span>
            <StatusPill status={condition.status} kind={conditionKind(condition)} />
            <span
              className="text-right text-xs text-muted"
              title={condition.lastTransitionTime ? absoluteTimestamp(condition.lastTransitionTime) : undefined}
            >
              {condition.lastTransitionTime ? `${ageFromTimestamp(condition.lastTransitionTime)} ago` : ""}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** A formatted list, one item per line — env vars, mounts, ports, probe chips. */
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
 * One container's card — app, init or ephemeral. State and restart count come
 * from its `containerStatuses` entry (absent while the pod is still being
 * scheduled, e.g. an init container that hasn't started); ports, probes,
 * environment and mounts come from the spec and are omitted outright, not
 * shown empty, when the container has none.
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
  const restarts = status?.restartCount;
  const lastRestart = status ? containerLastRestartTime(status) : "";
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

  return (
    <div className="flex flex-col gap-1.5">
      <SubHead>
        <span className="flex items-center gap-2">
          {name}
          {state && <StatusPill status={state.text} kind={state.kind} />}
        </span>
      </SubHead>
      {restarts != null && <KV k="Restarts" v={str(restarts)} />}
      {lastRestart && <KV k="Last restart" v={timestampWithAge(lastRestart, Date.now())} />}
      {image && <KV k="Image" v={image} mono />}
      {ports.length > 0 && <KV k="Ports" v={<StringList items={ports.map(portText)} />} />}
      {env.length > 0 && <KV k="Environment" v={<StringList items={env.map(envText)} />} />}
      {mounts.length > 0 && <KV k="Mounts" v={<StringList items={mounts.map(mountText)} />} />}
      {Object.keys(liveness).length > 0 && <KV k="Liveness" v={<StringList items={probeChips(liveness)} />} />}
      {Object.keys(readiness).length > 0 && <KV k="Readiness" v={<StringList items={probeChips(readiness)} />} />}
      {Object.keys(startup).length > 0 && <KV k="Startup" v={<StringList items={probeChips(startup)} />} />}
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
    <Panel title={title}>
      <div className="flex flex-col gap-4">
        {containers.map((c) => (
          <ContainerCard key={str(c.name)} container={c} status={statuses.get(str(c.name))} />
        ))}
      </div>
    </Panel>
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
      <Panel title="Containers">
        {containers.length === 0 ? (
          <EmptyState title="No containers" />
        ) : (
          <div className="flex flex-col gap-4">
            {containers.map((c) => (
              <ContainerCard key={str(c.name)} container={c} status={containerStatuses.get(str(c.name))} />
            ))}
          </div>
        )}
      </Panel>
      <ContainerGroup
        title="Ephemeral containers"
        containers={ephemeralContainers}
        statuses={statusesByName(status.ephemeralContainerStatuses)}
      />
    </>
  );
}
