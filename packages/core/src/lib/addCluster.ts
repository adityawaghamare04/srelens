// Cross-platform "Add cluster" + "Test connection", used by the Add-cluster
// form on both desktop and web.
//
// - Web stores the cluster server-side (POST /api/clusters) where a
//   srelens-managed OIDC token authenticates it.
// - Desktop synthesizes the kubeconfig (reusing the same Rust synthesis via a
//   capability, so output is identical) and saves it under the app config dir;
//   the user's native kubelogin/oidc-login plugin authenticates it.
//
// Both surfaces test-connect through capabilities (`k8s.synthesizeCluster‑
// Kubeconfig` + `k8s.testClusterConnection`), which run identically via the
// Tauri command bridge on desktop and `/api/capability/:id` on web.
import { isTauri } from "../transport/platform";
import { invokeCapability } from "../transport/transport";
import { savePastedKubeconfig } from "./files";
import { createCluster as createClusterWeb, type CreateClusterInput } from "./webClusters";

export type { CreateClusterInput };

export interface TestResult {
  reachable: boolean;
  version?: string | null;
  error?: string | null;
}

/**
 * Add a cluster from form fields. On web the server stores it and returns
 * nothing; on desktop the synthesized kubeconfig is saved locally and its file
 * path is returned so the caller can track it in the kubeconfig source list.
 */
export async function addCluster(input: CreateClusterInput): Promise<string | undefined> {
  if (!isTauri()) {
    await createClusterWeb(input);
    return undefined;
  }
  const { yaml } = await invokeCapability<{ yaml: string }>(
    "k8s.synthesizeClusterKubeconfig",
    input,
  );
  return savePastedKubeconfig(yaml, input.name.trim());
}

/** Test-connect a form-defined cluster before saving: synthesize, then probe. */
export async function testClusterForm(input: CreateClusterInput): Promise<TestResult> {
  const { yaml } = await invokeCapability<{ yaml: string }>(
    "k8s.synthesizeClusterKubeconfig",
    input,
  );
  return invokeCapability<TestResult>("k8s.testClusterConnection", {
    yaml,
    context: input.name.trim(),
  });
}

/**
 * The `current-context` a kubeconfig names, or null if it names none.
 *
 * Deliberately not one regex. The previous single pattern paired `\s*` around a
 * lazy body with a trailing `\s*$`, which gave the engine several ways to split
 * the same run of spaces: a 4KB line of them took 51 seconds, and the cost grew
 * cubically, so 8KB took minutes (js/polynomial-redos, #43). A kubeconfig is
 * pasted or uploaded, so that is a way to freeze the app from outside it.
 *
 * Matching only up to the end of the line and trimming in code is linear, and
 * far easier to read besides.
 */
export function parseCurrentContext(yaml: string): string | null {
  const match = /^[^\S\n]*current-context:([^\n]*)$/m.exec(yaml);
  if (!match) return null;
  return unquoteScalar(match[1].trim());
}

/**
 * The value of a YAML scalar, with any trailing comment removed.
 *
 * Comment handling follows YAML rather than "cut at the first #": a `#` only
 * starts a comment when whitespace precedes it, and never inside quotes. A
 * context name may legitimately contain one — `prod#live` is a valid name, and
 * splitting on every `#` turned it into `prod`, or `"prod` when quoted, so
 * srelens then probed a context that does not exist.
 *
 * Done with string scanning rather than a pattern: this is on the path that
 * reads a pasted kubeconfig, and it is the ambiguity in the regex that used to
 * live here which made that path a denial of service.
 */
function unquoteScalar(raw: string): string | null {
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    const close = raw.indexOf(quote, 1);
    // An unterminated quote is malformed; there is no scalar to read.
    if (close === -1) return null;
    return raw.slice(1, close) || null;
  }
  // Unquoted: a comment needs whitespace in front of the `#`.
  let end = raw.length;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "#" && (i === 0 || raw[i - 1] === " " || raw[i - 1] === "\t")) {
      end = i;
      break;
    }
  }
  return raw.slice(0, end).trim() || null;
}

/** Test-connect a pasted/uploaded kubeconfig by its `current-context`. */
export async function testKubeconfigYaml(yaml: string): Promise<TestResult> {
  const context = parseCurrentContext(yaml);
  if (!context) throw new Error("kubeconfig has no current-context to test");
  return invokeCapability<TestResult>("k8s.testClusterConnection", { yaml, context });
}
