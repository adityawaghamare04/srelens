import React, { Suspense, lazy, useState } from "react";
import { CircleCheck, FilePlus2 } from "lucide-react";
import { Button, Combobox, Spinner } from "../ui";
import { applyManifest, validateManifest } from "../lib/manifest";
import { openApiSchema } from "../lib/schema";

const CodeEditor = lazy(() => import("../ui/CodeEditor").then((m) => ({ default: m.CodeEditor })));

/** Starter manifests for common kinds, namespaced where relevant. */
const TEMPLATES: Record<string, (ns: string) => string> = {
  Blank: () => "",
  Deployment: (ns) =>
    `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: ${ns}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: nginx:1.27
          ports:
            - containerPort: 80
`,
  Service: (ns) =>
    `apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: ${ns}
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
`,
  ConfigMap: (ns) =>
    `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  namespace: ${ns}
data:
  key: value
`,
  Secret: (ns) =>
    `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: ${ns}
type: Opaque
stringData:
  key: value
`,
  Ingress: (ns) =>
    `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: ${ns}
spec:
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port:
                  number: 80
`,
  Namespace: () =>
    `apiVersion: v1
kind: Namespace
metadata:
  name: my-namespace
`,
};

const TEMPLATE_ORDER = ["Blank", "Deployment", "Service", "ConfigMap", "Secret", "Ingress", "Namespace"];

/**
 * A full-tab "new resource" editor: pick a starter template, edit YAML with
 * k8s syntax highlighting, and apply (server-side apply, which creates when the
 * object doesn't exist). Stays open after applying so you can create several.
 */
export function NewResourceEditor({
  context,
  namespace = "default",
  initialKind,
  onCreated,
}: {
  context: string;
  namespace?: string;
  /** k8s Kind (e.g. "Deployment") to preselect a template. */
  initialKind?: string;
  onCreated?: () => void;
}) {
  const ns = namespace || "default";
  const startTemplate = initialKind && TEMPLATES[initialKind] ? initialKind : "Deployment";
  const [template, setTemplate] = useState(startTemplate);
  const [yaml, setYaml] = useState(() => TEMPLATES[startTemplate](ns));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ kind: string; name: string } | null>(null);

  function pickTemplate(t: string) {
    setTemplate(t);
    setYaml(TEMPLATES[t](ns));
    setResult(null);
    setError("");
  }

  async function create() {
    setBusy(true);
    setError("");
    setResult(null);
    const out = await applyManifest(context, yaml);
    setBusy(false);
    if (out.error) {
      setError(out.error);
      return;
    }
    setResult({ kind: out.kind ?? "", name: out.name ?? "" });
    onCreated?.();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="font-medium">New resource</span>
        <span className="text-xs text-muted-foreground">on {context}</span>
        <span className="mx-1 text-xs text-muted-foreground">Template</span>
        <Combobox
          value={template}
          onValueChange={pickTemplate}
          options={TEMPLATE_ORDER.map((t) => ({ value: t }))}
          ariaLabel="Template"
          searchPlaceholder="Search templates…"
          className="min-w-40"
        />
        <div className="ml-auto flex items-center gap-3">
          {result && (
            <span className="fl-apply-success">
              <CircleCheck aria-hidden="true" />
              Applied {result.kind} <code>{result.name}</code>
            </span>
          )}
          {error && <span className="max-w-md truncate text-destructive" title={error}>Error: {error}</span>}
          <Button onClick={() => void create()} disabled={busy || !yaml.trim()}>
            {busy ? (
              <Spinner label="Creating resource" data-icon="inline-start" />
            ) : (
              <FilePlus2 data-icon="inline-start" />
            )}
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<Spinner label="Loading editor" />}>
          {/* Absolute-inset pins CodeMirror to a definite-height box so it fills
              the tab (its own height:100% then resolves) instead of collapsing. */}
          <div className="absolute inset-0">
            <CodeEditor
              value={yaml}
              onChange={setYaml}
              language="yaml"
              ariaLabel="New resource YAML"
              fill
              schemaValidate={(y) =>
                validateManifest(context, y).then((r) => (r.valid === false ? r.errors ?? [] : []))
              }
              schemaSource={(apiVersion, kind) =>
                openApiSchema(context, apiVersion, kind).then((r) => ("error" in r ? null : r))
              }
            />
          </div>
        </Suspense>
      </div>
    </div>
  );
}
