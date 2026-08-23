/**
 * Base64/JSON helpers for Secret data, plus TLS certificate parsing.
 *
 * `publicKeyAlgorithm` and `certificateRows` depend on `X509Certificate` from
 * `@peculiar/x509`. An earlier ruling (R-7) kept that dependency out of the
 * service layer and left this parsing in classic
 * (`apps/desktop/src/components/ResourceOverview.tsx`) alone. That ruling has
 * since been overruled: `@peculiar/x509` is now a declared dependency here so
 * both classic and ui-next can share one implementation.
 *
 * The property that survived the reversal: certificate parsing must still
 * stay out of the *main* bundle. `certificateRows` therefore keeps classic's
 * `await import("@peculiar/x509")` (preceded by `await import("reflect-metadata")`,
 * which the library needs for its decorator metadata) inside the function
 * body rather than a static top-level import — only `import type` reaches the
 * module scope, which erases at build time and carries no runtime weight.
 * Whoever calls `certificateRows` still only pays for the parser's bytes when
 * that code path actually runs.
 */
import { asRecord, str } from "./k8sRaw";
import { formatBytes } from "./k8sQuantity";
import type { X509Certificate } from "@peculiar/x509";

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

/** One certificate in a TLS Secret's chain, as classic's `TlsSecretBody` table
 *  renders it: role in the chain, the facts parsed off it, and its encoded
 *  size. `status`/`subject`/etc. are "" or "Invalid" (never omitted) when the
 *  PEM block itself failed to parse. */
export interface CertificateRow {
  key: string;
  role: string;
  subject: string;
  issuer: string;
  serial: string;
  validFrom: string;
  validUntil: string;
  status: string;
  keyAlgorithm: string;
  sans: string[];
  size: string;
}

/** The public key's algorithm and size/curve, e.g. "RSASSA-PKCS1-v1_5
 *  2048-bit" or "ECDSA P-256" — moved byte-for-byte from classic's
 *  `ResourceOverview.tsx` per the R-7 reversal (see this file's header). */
export function publicKeyAlgorithm(certificate: X509Certificate): string {
  const algorithm = certificate.publicKey.algorithm as Algorithm & {
    modulusLength?: number;
    namedCurve?: string;
  };
  if (algorithm.namedCurve) return `${algorithm.name} ${algorithm.namedCurve}`;
  if (algorithm.modulusLength) return `${algorithm.name} ${algorithm.modulusLength}-bit`;
  return algorithm.name;
}

/** Parse every PEM certificate block in `pem` into a {@link CertificateRow}.
 *  The first block is the leaf; every block after it is a numbered chain
 *  entry. A block that fails to parse still gets a row — "Invalid" status,
 *  empty facts, but a real size — rather than being dropped, so the table's
 *  certificate count always matches what `pem` actually contained. */
export async function certificateRows(pem: string): Promise<CertificateRow[]> {
  await import("reflect-metadata");
  const { SubjectAlternativeNameExtension, X509Certificate } = await import("@peculiar/x509");
  const matches = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  return matches.map((pemCertificate, index) => {
    const fallback: CertificateRow = {
      key: String(index),
      role: index === 0 ? "Leaf" : `Chain ${index}`,
      subject: "Unable to parse certificate",
      issuer: "",
      serial: "",
      validFrom: "",
      validUntil: "",
      status: "Invalid",
      keyAlgorithm: "",
      sans: [],
      size: formatBytes(new TextEncoder().encode(pemCertificate).length),
    };
    try {
      const certificate = new X509Certificate(pemCertificate);
      const now = Date.now();
      const expires = certificate.notAfter.getTime();
      const starts = certificate.notBefore.getTime();
      const status = now < starts
        ? "Not yet valid"
        : now > expires
          ? "Expired"
          : expires - now < 30 * 86_400_000
            ? "Expires soon"
            : "Valid";
      const san = certificate.getExtension(SubjectAlternativeNameExtension);
      return {
        ...fallback,
        subject: certificate.subject,
        issuer: certificate.issuer,
        serial: certificate.serialNumber,
        validFrom: certificate.notBefore.toISOString(),
        validUntil: certificate.notAfter.toISOString(),
        status,
        keyAlgorithm: publicKeyAlgorithm(certificate),
        sans: san?.names.items.map((name) => name.value) ?? [],
      };
    } catch {
      return fallback;
    }
  });
}
