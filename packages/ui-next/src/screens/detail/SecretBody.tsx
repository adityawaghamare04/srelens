import { useEffect, useState } from "react";
import {
  decodeBase64,
  decodedByteLength,
  dockerRegistries,
  formatBytes,
  getSecret,
  plural,
  str,
  type DockerRegistryRow,
  type K8sObject,
} from "@srelens/core";
import { Button, EmptyState, KV, Panel, Table, type Column } from "@srelens/ui-kit";

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
    <Panel title={`Data (${plural(keys.length, "key")})`}>
      {keys.length === 0 ? (
        <EmptyState title="No data" />
      ) : (
        <div className="flex flex-col gap-4">
          {keys.map((key) => (
            <SecretEntry key={key} name={key} value={str(data[key])} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * TLS material — classic's `TlsSecretBody`, MINUS every fact that comes from
 * actually parsing the certificate (`certificateRows`): Subject, Issuer,
 * Serial number, Certificate status, Public key algorithm, Valid from/until,
 * DNS/IP names, and the per-certificate table. Those all need
 * `X509Certificate` from `@peculiar/x509`, a dependency `apps/desktop` has
 * and `@srelens/core` does not (classic imports it dynamically to keep
 * certificate parsing out of its main bundle — see `k8sSecret.ts`'s doc
 * comment and ruling R-7). Whether to add that dependency to core, do
 * certificate parsing in `ui-next` instead, or go without the algorithm
 * detail is a dependency decision the task brief says to stop and report on
 * rather than settle here — see the task report. Everything that does NOT
 * need the certificate parsed — the certificate count (a regex over
 * `BEGIN CERTIFICATE` markers), the private key's format (`privateKeyType`,
 * itself just a PEM-header regex), and both materials' encoded size — is
 * ported below.
 */
function TlsSection({ data }: { data: Record<string, string> }) {
  const certificate = decodeBase64(str(data["tls.crt"]));
  const privateKey = decodeBase64(str(data["tls.key"]));
  const count = certificateCount(certificate);
  return (
    <Panel title="TLS material">
      <KV k="Type" v="kubernetes.io/tls" />
      <KV k="Certificates" v={count > 0 ? plural(count, "certificate") : "Missing tls.crt"} />
      <KV k="Private key" v={privateKeyType(privateKey)} />
      {data["tls.crt"] && <KV k="Certificate data" v={formatBytes(decodedByteLength(data["tls.crt"]))} />}
      {data["tls.key"] && <KV k="Private key data" v={formatBytes(decodedByteLength(data["tls.key"]))} />}
    </Panel>
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
    <Panel title="Docker registries">
      <KV k="Type" v={type} />
      <KV k="Registries" v={plural(registries.length, "registry", "registries")} />
      {data[configKey] && <KV k="Config size" v={formatBytes(decodedByteLength(data[configKey]))} />}
      {registries.length > 0 ? (
        <Table columns={DOCKER_COLUMNS} data={registries} getRowKey={(row) => row.registry} />
      ) : (
        <EmptyState title="No valid registry credentials found" />
      )}
    </Panel>
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
    <Panel title="Secret summary">
      <KV k="Type" v={str(object.type) || "Opaque"} />
      <KV k="Keys" v={plural(keyCount, "key")} />
      <KV k="Immutable" v={immutable ? "Yes" : "No"} />
    </Panel>
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
