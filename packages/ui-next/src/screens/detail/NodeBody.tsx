import { asRecord, str, type K8sObject } from "@srelens/core";
import { KV, Section, StatusPill } from "@srelens/ui-kit";

/**
 * A Node's runtime identity — classic's "Info" section, ported fact-for-fact:
 * whether the node is schedulable, its kubelet, OS image, kernel, container
 * runtime and CPU architecture. Node conditions (Ready, MemoryPressure, ...)
 * come from `GenericBody`'s Conditions table, not from here.
 */
function InfoSection({ object }: { object: K8sObject }) {
  const spec = asRecord(object.spec);
  const status = asRecord(object.status);
  const info = asRecord(status.nodeInfo);
  const cordoned = spec.unschedulable === true;

  return (
    <Section title="Info">
      <KV
        k="Scheduling"
        v={
          <StatusPill
            status={cordoned ? "Disabled (cordoned)" : "Enabled"}
            kind={cordoned ? "warning" : "success"}
          />
        }
      />
      <KV k="Kubelet" v={str(info.kubeletVersion)} />
      <KV k="OS image" v={str(info.osImage)} />
      <KV k="Kernel" v={str(info.kernelVersion)} />
      <KV k="Container runtime" v={str(info.containerRuntimeVersion)} />
      <KV k="Architecture" v={str(info.architecture)} />
    </Section>
  );
}

/**
 * A Node's capacity — classic's "Capacity" section: CPU, memory and pod
 * counts, each shown as "allocatable / capacity" the way classic does.
 */
function CapacitySection({ object }: { object: K8sObject }) {
  const status = asRecord(object.status);
  const capacity = asRecord(status.capacity);
  const allocatable = asRecord(status.allocatable);

  return (
    <Section title="Capacity">
      <KV k="CPU" v={`${str(allocatable.cpu)} / ${str(capacity.cpu)}`} />
      <KV k="Memory" v={`${str(allocatable.memory)} / ${str(capacity.memory)}`} />
      <KV k="Pods" v={`${str(allocatable.pods)} / ${str(capacity.pods)}`} />
    </Section>
  );
}

/**
 * A Node's Details pane: Info and Capacity, in classic's own order
 * (`NodeBody`). `relatedPodSelector` has no case for "Node", so `GenericBody`
 * fetches no related pods for one; its Metadata and Conditions sections still
 * wrap this body, which is why neither is repeated here.
 */
export function NodeDetailsBody({ object }: { object: K8sObject }) {
  return (
    <>
      <InfoSection object={object} />
      <CapacitySection object={object} />
    </>
  );
}
