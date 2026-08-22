import { asRecord, asArray, str } from "./k8sRaw";
import type { K8sObject } from "./manifest";

/**
 * One line per affinity type in use, e.g. "Node affinity: 2 required, 1
 * preferred". `nodeAffinity` counts `nodeSelectorTerms`; pod (anti-)affinity
 * count their rule arrays directly. Types with no rules are omitted.
 */
export function summarizeAffinity(affinity: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const describe = (label: string, rule: Record<string, unknown>, requiredIsTerms: boolean) => {
    const required = requiredIsTerms
      ? asArray(asRecord(rule.requiredDuringSchedulingIgnoredDuringExecution).nodeSelectorTerms).length
      : asArray(rule.requiredDuringSchedulingIgnoredDuringExecution).length;
    const preferred = asArray(rule.preferredDuringSchedulingIgnoredDuringExecution).length;
    if (required === 0 && preferred === 0) return;
    const parts: string[] = [];
    if (required) parts.push(`${required} required`);
    if (preferred) parts.push(`${preferred} preferred`);
    lines.push(`${label}: ${parts.join(", ")}`);
  };
  describe("Node affinity", asRecord(affinity.nodeAffinity), true);
  describe("Pod affinity", asRecord(affinity.podAffinity), false);
  describe("Pod anti-affinity", asRecord(affinity.podAntiAffinity), false);
  return lines;
}

/** "RollingUpdate (partition 2)" / "RollingUpdate (max unavailable 1)" / "OnDelete". */
export function updateStrategyText(strategy: Record<string, unknown>): string {
  const type = str(strategy.type) || "RollingUpdate";
  const ru = asRecord(strategy.rollingUpdate);
  const parts: string[] = [];
  if (ru.partition != null) parts.push(`partition ${str(ru.partition)}`);
  if (ru.maxUnavailable != null) parts.push(`max unavailable ${str(ru.maxUnavailable)}`);
  if (ru.maxSurge != null) parts.push(`max surge ${str(ru.maxSurge)}`);
  return parts.length ? `${type} (${parts.join(", ")})` : type;
}

export function relatedPodSelector(kind: string, obj: K8sObject): Record<string, string> {
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
