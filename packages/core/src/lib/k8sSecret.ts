/**
 * Base64/JSON helpers for Secret data. `publicKeyAlgorithm` and
 * `privateKeyType` (TLS certificate parsing, in
 * `apps/desktop/src/components/ResourceOverview.tsx`) deliberately stay in
 * classic: they depend on `X509Certificate` from `@peculiar/x509`, a
 * dependency `apps/desktop` has and core does not, and classic imports it
 * dynamically to keep certificate parsing out of the main bundle. Moving them
 * here would add that dependency to the service layer and undo that bundling
 * decision.
 */
import { asRecord, str } from "./k8sRaw";

export function decodeBase64(v: string): string {
  try {
    const binary = atob(v);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return v;
  }
}

export interface DockerRegistryRow {
  registry: string;
  username: string;
  credential: string;
}

export function dockerRegistries(data: Record<string, string>, type: string): DockerRegistryRow[] {
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
