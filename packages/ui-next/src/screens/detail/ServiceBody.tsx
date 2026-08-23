import { useEffect, useState } from "react";
import {
  asArray,
  asRecord,
  listEndpointSlices,
  serviceExternalAddress,
  str,
  type K8sObject,
} from "@srelens/core";
import { KV, PairList, Section, Table, type Column } from "@srelens/ui-kit";
import { StringList } from "./sections";

/**
 * How the Service is reached — classic's "Connection" section, ported
 * fact-for-fact: Type, Cluster IP, External IP (core's own
 * `serviceExternalAddress`, which already encodes classic's LoadBalancer
 * `<pending>` / ExternalName rules), Session affinity, Selector. Selector is
 * OMITTED when empty rather than shown as classic's `Chips` widget does
 * ("None") — the same convention `WorkloadBody`'s Properties section settled
 * on, kept here too rather than reintroducing classic's "None" text for this
 * body alone.
 */
function ConnectionSection({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const selector = asRecord(spec.selector) as Record<string, string>;

  return (
    <Section title="Connection">
      <KV k="Type" v={str(spec.type) || "ClusterIP"} />
      <KV k="Cluster IP" v={str(spec.clusterIP)} mono />
      <KV k="External IP" v={serviceExternalAddress(object) || "—"} mono />
      <KV k="Session affinity" v={str(spec.sessionAffinity)} />
      {/* `breakValues`: `PairList` truncates by default and no longer writes
          the value into a row `title` — that attribute was how a Secret's
          whole applied manifest reached the DOM — so wrapping is the only way
          a long selector key/value can be read at all. */}
      {Object.keys(selector).length > 0 && (
        <KV k="Selector" v={<PairList pairs={Object.entries(selector)} breakValues />} />
      )}
    </Section>
  );
}

interface PortRow {
  key: string;
  name: string;
  port: string;
  target: string;
  protocol: string;
}

const PORT_COLUMNS: Column<PortRow>[] = [
  { key: "name", header: "Name", render: (p) => p.name },
  { key: "port", header: "Port", render: (p) => <span className="font-mono">{p.port}</span> },
  { key: "target", header: "Target", render: (p) => <span className="font-mono">{p.target}</span> },
  { key: "protocol", header: "Protocol", render: (p) => p.protocol },
];

/**
 * The Service's own ports — classic's "Ports" table, shown only when the
 * Service declares any (an ExternalName service, for instance, has none).
 * "Port" folds in the node port the way classic does ("80:30080"). Classic
 * also offers an inline port-forward button on this table when the Service
 * has a selector; that is a WRITE affordance, and neither ui-next nor the
 * kit has a forward dialog yet — `PodBody`'s Containers pane made the same
 * call for a container's ports (see the task report).
 */
function PortsSection({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const ports: PortRow[] = asArray(spec.ports).map((p, i) => {
    const pr = asRecord(p);
    return {
      key: str(pr.name) || `port-${i}`,
      name: str(pr.name) || "—",
      port: str(pr.port) + (pr.nodePort ? `:${str(pr.nodePort)}` : ""),
      target: str(pr.targetPort),
      protocol: str(pr.protocol) || "TCP",
    };
  });
  if (ports.length === 0) return null;
  return (
    <Section title="Ports">
      <Table columns={PORT_COLUMNS} data={ports} getRowKey={(p) => p.key} />
    </Section>
  );
}

/**
 * The EndpointSlices backing this Service — classic's "Endpoint Slices",
 * matched by the `kubernetes.io/service-name` label the backend surfaces as
 * `service` on `EndpointSliceSummary`, fetched live via core's
 * `listEndpointSlices`. Classic renders nothing at all while the fetch is in
 * flight or comes back empty (no spinner, no empty-state row) — this section
 * only ever appears once slices are found, and that is kept here too rather
 * than inventing a loading state classic never had. Each slice is
 * `ResourceLink`-navigable in classic; here it renders as inert
 * "EndpointSlice/name" text — see the task report for the full inert-value
 * list.
 */
function EndpointSlicesSection({ context, object }: { context: string; object: K8sObject }) {
  const namespace = str(object.metadata?.namespace);
  const name = str(object.metadata?.name);
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    setNames([]);
    if (!context || !namespace || !name) return;
    let active = true;
    listEndpointSlices(context, namespace).then((out) => {
      if (!active) return;
      const mine = (out.endpointslices ?? []).filter((s) => s.service === name).map((s) => s.name);
      setNames(mine);
    });
    return () => {
      active = false;
    };
  }, [context, namespace, name]);

  if (names.length === 0) return null;
  return (
    <Section title="Endpoint Slices">
      <StringList items={names.map((n) => `EndpointSlice/${n}`)} />
    </Section>
  );
}

/**
 * A Service's Details pane: Connection, Ports and Endpoint Slices, in
 * classic's own order (`ServiceBody`). Related pods and Conditions come from
 * `GenericBody`, not from here — `relatedPodSelector` returns the Service's
 * own `spec.selector` non-empty, so `GenericBody` already renders a "Pods"
 * section for a Service with one; rendering another here would duplicate it,
 * exactly the mistake a workload body made for DaemonSet (see the task
 * report).
 */
export function ServiceDetailsBody({ object, context }: { object: K8sObject; context: string }) {
  return (
    <>
      <ConnectionSection object={object} />
      <PortsSection object={object} />
      <EndpointSlicesSection context={context} object={object} />
    </>
  );
}
