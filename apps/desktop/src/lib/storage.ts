import { invokeCapability, type Invoker } from "../transport/transport";
import type { PodSummary } from "./workloads";

/** PersistentVolumeClaim row — mirrors `crates/kube/src/pvcs.rs`. */
export interface PvcSummary {
  name: string;
  namespace: string;
  status: string;
  capacity: string;
  accessModes: string;
  storageClass: string;
  volume: string;
  age: string;
}

/** PersistentVolume row — mirrors `crates/kube/src/persistentvolumes.rs` (cluster-scoped). */
export interface PvSummary {
  name: string;
  capacity: string;
  accessModes: string;
  reclaimPolicy: string;
  status: string;
  /** Bound claim as "namespace/name", empty when unbound. */
  claim: string;
  storageClass: string;
  age: string;
}

/** StorageClass row — mirrors `crates/kube/src/storageclasses.rs` (cluster-scoped). */
export interface StorageClassSummary {
  name: string;
  provisioner: string;
  reclaimPolicy: string;
  volumeBindingMode: string;
  default: boolean;
  age: string;
}

/** List PVCs in a namespace via `k8s.listPersistentVolumeClaims`. */
export async function listPersistentVolumeClaims(
  context: string,
  namespace: string,
  invoke: Invoker = invokeCapability,
): Promise<{ persistentvolumeclaims?: PvcSummary[]; error?: string }> {
  try {
    const out = await invoke<{ persistentvolumeclaims: PvcSummary[] }>("k8s.listPersistentVolumeClaims", {
      context,
      namespace,
    });
    return { persistentvolumeclaims: out.persistentvolumeclaims };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List cluster PersistentVolumes via `k8s.listPersistentVolumes`. */
export async function listPersistentVolumes(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<{ persistentvolumes?: PvSummary[]; error?: string }> {
  try {
    const out = await invoke<{ persistentvolumes: PvSummary[] }>("k8s.listPersistentVolumes", { context });
    return { persistentvolumes: out.persistentvolumes };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List pods that mount a PVC via `k8s.podsForPvc` (the claim's consumers). */
export async function podsForPvc(
  context: string,
  namespace: string,
  pvc: string,
  invoke: Invoker = invokeCapability,
): Promise<{ pods?: PodSummary[]; error?: string }> {
  try {
    const out = await invoke<{ pods: PodSummary[] }>("k8s.podsForPvc", { context, namespace, pvc });
    return { pods: out.pods };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List cluster StorageClasses via `k8s.listStorageClasses`. */
export async function listStorageClasses(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<{ storageclasses?: StorageClassSummary[]; error?: string }> {
  try {
    const out = await invoke<{ storageclasses: StorageClassSummary[] }>("k8s.listStorageClasses", { context });
    return { storageclasses: out.storageclasses };
  } catch (e) {
    return { error: String(e) };
  }
}
