import { useEffect, useState } from "react";
import {
  absoluteTimestamp,
  certificateHealth,
  certificateRows,
  decodeBase64,
  decodedByteLength,
  dockerRegistries,
  formatBytes,
  getSecret,
  plural,
  str,
  type CertificateRow,
  type DockerRegistryRow,
  type K8sObject,
} from "@srelens/core";
import { Button, EmptyState, KV, Section, Spinner, StatusPill, Table, type Column } from "@srelens/ui-kit";
import { StringList } from "./sections";

/**
 * A private key's format, read straight off its PEM header — classic's
 * `privateKeyType`. Unlike `publicKeyAlgorithm` (see `TlsSection` below),
 * this needs no certificate-parsing dependency: it is a plain regex over the
 * PEM text, so it is ported here directly rather than left for the R-7
 * dependency decision.
 */
function privateKeyType(pem: string): string {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) return "RSA (PKCS#1)";
  if (/BEGIN EC PRIVATE KEY/.test(pem)) return "EC (SEC1)";
  if (/BEGIN ENCRYPTED PRIVATE KEY/.test(pem)) return "Encrypted PKCS#8";
  if (/BEGIN PRIVATE KEY/.test(pem)) return "PKCS#8";
  return pem ? "Unrecognized format" : "Missing";
}

function certificateCount(pem: string): number {
  return pem.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0;
}


const CERTIFICATE_COLUMNS: Column<CertificateRow>[] = [
  { key: "role", header: "Certificate", render: (row) => row.role },
  { key: "subject", header: "Subject", render: (row) => <span className="font-mono">{row.subject}</span> },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusPill status={row.status} kind={certificateHealth(row.status)} />,
  },
  { key: "size", header: "Size", render: (row) => row.size },
];

/**
 * One Secret entry — key and value, the value masked until the reader
 * explicitly reveals it (classic's `ConfigDataEntry` with `secret: true`).
 *
 * THE RULING THIS PORTS EXACTLY: a Secret's values are secret. Before
 * `revealed` flips true, `decodeBase64(value)` is never called and the
 * decoded text never becomes a child of anything — the masked placeholder
 * "••••••••" is the only value in the tree, so there is nothing for a
 * screen reader, a DOM inspector or a copy-all to find. No `title`,
 * `aria-label`, or `data-*` carries the value either; the toggle's own label
 * is just "Reveal"/"Hide", never the key's value.
 */
function SecretEntry({ name, value }: { name: string; value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[0.8125rem] font-medium">{name}</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => setRevealed((r) => !r)}>
          {revealed ? "Hide" : "Reveal"}
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-[0.8125rem] text-muted">
        {revealed ? decodeBase64(value) : "••••••••"}
      </pre>
    </div>
  );
}

/**
 * A Secret's `data` keys, each behind its own reveal toggle — classic's
 * `SecretData`, shared by all three Secret bodies below (TLS and Docker
 * secrets show it after their own summary section; a general Secret shows it
 * as its only section besides "Secret summary").
 */
function SecretDataSection({ data }: { data: Record<string, string> }) {
  const keys = Object.keys(data);
  return (
    <Section title={`Data (${plural(keys.length, "key")})`}>
      {keys.length === 0 ? (
        <EmptyState title="No data" />
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((key) => (
            <SecretEntry key={key} name={key} value={str(data[key])} />
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * TLS material — classic's `TlsSecretBody`, including every fact that comes
 * from actually parsing the certificate: Certificate status, Subject,
 * Issuer, Serial number, Public key, Valid from/until, DNS/IP names, and the
 * per-certificate table. Those all need `X509Certificate` from
 * `@peculiar/x509`; the R-7 ruling that kept that dependency (and this
 * parsing) out of `@srelens/core` has been overruled, and `certificateRows`
 * now lives in `k8sSecret.ts` — see its doc comment for how the bundling
 * property R-7 protected survives the reversal (the parser is still loaded
 * via a dynamic `import()`, not a static one, so it stays out of the main
 * bundle for every consumer, ui-next included).
 *
 * None of these facts come from the private key, so none of them sit behind
 * the reveal gate — same as classic. Only the raw `tls.crt`/`tls.key` bytes
 * stay masked, via `SecretDataSection` below.
 */
function TlsSection({ data }: { data: Record<string, string> }) {
  const certificate = decodeBase64(str(data["tls.crt"]));
  const privateKey = decodeBase64(str(data["tls.key"]));
  const count = certificateCount(certificate);
  const [certificates, setCertificates] = useState<CertificateRow[] | null>(null);
  useEffect(() => {
    let active = true;
    if (count === 0) {
      setCertificates([]);
    } else {
      certificateRows(certificate)
        .then((rows) => {
          if (active) setCertificates(rows);
        })
        .catch(() => {
          if (active) setCertificates([]);
        });
    }
    return () => {
      active = false;
    };
  }, [certificate, count]);
  const leaf = certificates?.[0];
  return (
    <Section title="TLS material">
      <KV k="Type" v="kubernetes.io/tls" />
      <KV k="Certificates" v={count > 0 ? plural(count, "certificate") : "Missing tls.crt"} />
      <KV k="Private key" v={privateKeyType(privateKey)} />
      {leaf && (
        <KV k="Certificate status" v={<StatusPill status={leaf.status} kind={certificateHealth(leaf.status)} />} />
      )}
      {leaf?.subject && <KV k="Subject" v={leaf.subject} />}
      {leaf?.issuer && <KV k="Issuer" v={leaf.issuer} />}
      {leaf?.serial && <KV k="Serial number" v={leaf.serial} mono />}
      {leaf?.keyAlgorithm && <KV k="Public key" v={leaf.keyAlgorithm} />}
      {leaf?.validFrom && <KV k="Valid from" v={absoluteTimestamp(leaf.validFrom)} />}
      {leaf?.validUntil && <KV k="Valid until" v={absoluteTimestamp(leaf.validUntil)} />}
      {leaf && leaf.sans.length > 0 && <KV k="DNS / IP names" v={<StringList items={leaf.sans} />} />}
      {data["tls.crt"] && <KV k="Certificate data" v={formatBytes(decodedByteLength(data["tls.crt"]))} />}
      {data["tls.key"] && <KV k="Private key data" v={formatBytes(decodedByteLength(data["tls.key"]))} />}
      {certificates === null && count > 0 && <Spinner label="Reading certificates" />}
      {certificates && certificates.length > 0 && (
        <Table columns={CERTIFICATE_COLUMNS} data={certificates} getRowKey={(row) => row.key} />
      )}
    </Section>
  );
}

const DOCKER_COLUMNS: Column<DockerRegistryRow>[] = [
  { key: "registry", header: "Registry", render: (row) => <span className="font-mono">{row.registry}</span> },
  { key: "username", header: "Username", render: (row) => row.username },
  { key: "credential", header: "Credential", render: (row) => row.credential },
];

/**
 * Docker registry credentials — classic's `DockerSecretBody`. `credential`
 * (from core's `dockerRegistries`) is a category ("Stored", "Identity
 * token", "Missing"), never the password/token itself.
 */
function DockerSection({ data, type }: { data: Record<string, string>; type: string }) {
  const configKey = type === "kubernetes.io/dockercfg" ? ".dockercfg" : ".dockerconfigjson";
  const registries = dockerRegistries(data, type);
  return (
    <Section title="Docker registries">
      <KV k="Type" v={type} />
      <KV k="Registries" v={plural(registries.length, "registry", "registries")} />
      {data[configKey] && <KV k="Config size" v={formatBytes(decodedByteLength(data[configKey]))} />}
      {registries.length > 0 ? (
        <Table columns={DOCKER_COLUMNS} data={registries} getRowKey={(row) => row.registry} />
      ) : (
        <EmptyState title="No valid registry credentials found" />
      )}
    </Section>
  );
}

/**
 * A generic (Opaque or otherwise unrecognized-type) Secret's summary —
 * classic's `GeneralSecretBody`'s "Secret summary" section: its type, how
 * many keys it holds, and whether it is immutable.
 */
function GeneralSection({ object, keyCount }: { object: K8sObject; keyCount: number }) {
  const immutable = object.immutable === true;
  return (
    <Section title="Secret summary">
      <KV k="Type" v={str(object.type) || "Opaque"} />
      <KV k="Keys" v={plural(keyCount, "key")} />
      <KV k="Immutable" v={immutable ? "Yes" : "No"} />
    </Section>
  );
}

/**
 * Fetch a Secret's real (base64) values via the gated `getSecret` —
 * `getObject` redacts Secret data (the keys are present, the values blank),
 * so this is how the detail view reaches the actual values. Falls back to
 * the redacted keys while the fetch is in flight or there is no `context`
 * (a static preview) — classic's own `useSecretData`. The fetched values sit
 * in memory once resolved, but nothing here renders them: `SecretEntry`
 * keeps every value masked until its own reveal toggle is used.
 */
function useSecretData(
  context: string,
  namespace: string,
  name: string,
  redacted: Record<string, string>,
): Record<string, string> {
  const [data, setData] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setData(null);
    if (!context) return;
    let active = true;
    getSecret(context, namespace, name).then((r) => {
      if (active && r.data) setData(r.data);
    });
    return () => {
      active = false;
    };
  }, [context, namespace, name]);
  return data ?? redacted;
}

/**
 * A Secret's Details pane — classic's `SecretBody`: dispatches on `type` to
 * TLS material, Docker registries, or a general summary, then always shows
 * the Data section beneath. Editing (`ConfigDataEditor`'s Save/Copy) is not
 * wired here — ui-next's Details panes are read-only, the same call every
 * other body in this table has made for its own write affordance.
 */
export function SecretDetailsBody({ object, context }: { object: K8sObject; context: string }) {
  const meta = object.metadata ?? {};
  const type = str(object.type) || "Opaque";
  const redacted = (object.data ?? {}) as Record<string, string>;
  const data = useSecretData(context, str(meta.namespace), str(meta.name), redacted);

  if (type === "kubernetes.io/tls") {
    return (
      <>
        <TlsSection data={data} />
        <SecretDataSection data={data} />
      </>
    );
  }
  if (type === "kubernetes.io/dockerconfigjson" || type === "kubernetes.io/dockercfg") {
    return (
      <>
        <DockerSection data={data} type={type} />
        <SecretDataSection data={data} />
      </>
    );
  }
  return (
    <>
      <GeneralSection object={object} keyCount={Object.keys(data).length} />
      <SecretDataSection data={data} />
    </>
  );
}
