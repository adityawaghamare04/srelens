import { invokeCapability, type Invoker } from "../transport/transport";

/**
 * One column a CRD asks tools to display, from its `additionalPrinterColumns`
 * — the same metadata `kubectl get` renders. Custom resources share no fields
 * beyond name/namespace/age, so this is the only way to show anything useful
 * about them (health, phase, version, replica counts…).
 */
export interface PrinterColumn {
  name: string;
  jsonPath: string;
  type: string;
}

/** A discovered CustomResourceDefinition, enough to list/view its instances. */
export interface CrdRef {
  name: string;
  group: string;
  version: string;
  kind: string;
  plural: string;
  namespaced: boolean;
  /** Optional: older backends and hand-built refs in tests may omit it. */
  printerColumns?: PrinterColumn[];
}

export interface CustomRow {
  name: string;
  namespace: string;
  age: string;
  /** Values for the CRD's printer columns, in declaration order. */
  columns?: string[];
}

/** Discover installed CRDs in a cluster via `k8s.listCRDs`. */
export async function listCrds(
  context: string,
  invoke: Invoker = invokeCapability,
): Promise<{ crds?: CrdRef[]; error?: string }> {
  try {
    const out = await invoke<{ crds: CrdRef[] }>("k8s.listCRDs", { context });
    return { crds: out.crds };
  } catch (e) {
    return { error: String(e) };
  }
}

/** List instances of a custom resource via `k8s.listCustomResource`. */
export async function listCustomResource(
  context: string,
  crd: CrdRef,
  namespace: string | null,
  invoke: Invoker = invokeCapability,
): Promise<{ items?: CustomRow[]; error?: string }> {
  try {
    const out = await invoke<{ items: CustomRow[] }>("k8s.listCustomResource", {
      context,
      group: crd.group,
      version: crd.version,
      plural: crd.plural,
      kind: crd.kind,
      namespaced: crd.namespaced,
      namespace: namespace ?? "",
      printerColumns: crd.printerColumns ?? [],
    });
    return { items: out.items };
  } catch (e) {
    return { error: String(e) };
  }
}
