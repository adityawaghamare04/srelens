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

/**
 * "RollingUpdate · surge 25% · unavailable 0" / "RollingUpdate · partition 2" /
 * "OnDelete".
 *
 * The form is the design mock's, read off frame A's Strategy row: a middle-dot
 * run rather than a parenthesised comma list, labels without their "max"
 * prefix, and surge named before unavailable. Where the mock and the build
 * disagree on a value's form, the mock wins.
 *
 * One helper, so a DaemonSet's Update strategy row reads the same way a
 * Deployment's does — the mock only draws the Deployment, but two forms for
 * one fact would be a worse answer than the one it does draw.
 */
export function updateStrategyText(strategy: Record<string, unknown>): string {
  const type = str(strategy.type) || "RollingUpdate";
  const ru = asRecord(strategy.rollingUpdate);
  const parts: string[] = [];
  // `!= null` and not a truthiness test: `maxUnavailable: 0` is a real
  // setting — take nothing down while rolling — and the strictest one there is.
  if (ru.partition != null) parts.push(`partition ${str(ru.partition)}`);
  if (ru.maxSurge != null) parts.push(`surge ${str(ru.maxSurge)}`);
  if (ru.maxUnavailable != null) parts.push(`unavailable ${str(ru.maxUnavailable)}`);
  return [type, ...parts].join(" · ");
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
