import React, { Suspense, lazy, useEffect, useState } from "react";
import { CircleCheck, Undo2, Upload } from "lucide-react";
import { getManifest, applyManifest, validateManifest } from "../lib/manifest";
import { notify } from "../lib/notify";
import { openApiSchema } from "../lib/schema";
import { Spinner, Button, ConfirmDialog } from "../ui";

// CodeMirror is heavy and only needed on the YAML tab — load it on demand so it
// stays out of the initial bundle.
const CodeEditor = lazy(() => import("../ui/CodeEditor").then((m) => ({ default: m.CodeEditor })));

/**
 * Manifest view + editor for any resource. Loads YAML via `k8s.getManifest`,
 * edits it in a CodeMirror editor (YAML highlighting, line numbers, find), and
 * server-side applies via `k8s.applyManifest` (behind a confirm).
 */
export function YamlView({
  context,
  kind,
  namespace,
  name,
  crd,
}: {
  context: string;
  kind: string;
  namespace: string | null;
  name: string;
  /** Dynamic GVK for custom resources (not in the static kind table). */
  crd?: { group: string; version: string; plural: string };
}) {
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applied, setApplied] = useState(false);

  function load() {
    let active = true;
    setOriginal(null);
    setError("");
    setApplied(false);
    void getManifest(context, kind, namespace, name, undefined, crd).then((out) => {
      if (!active) return;
      if (out.error) setError(out.error);
      else {
        setOriginal(out.yaml ?? "");
        setDraft(out.yaml ?? "");
      }
    });
    return () => {
      active = false;
    };
  }

  useEffect(load, [context, kind, namespace, name, crd]);

  async function apply() {
    setApplying(true);
    setApplyError("");
    const out = await applyManifest(context, draft);
    setApplying(false);
    if (out.error) {
      setApplyError(out.error);
      notify.error(`Failed to apply ${name}`, out.error);
      return;
    }
    setConfirming(false);
    setApplied(true);
    notify.success(`Applied ${name}`);
    load();
  }

  if (error) return <p style={{ color: "var(--fl-color-danger)" }}>Error: {error}</p>;
  if (original === null) return <Spinner label="Loading manifest" />;

  const dirty = draft !== original;

  return (
    <div>
      <Suspense fallback={<Spinner label="Loading editor" />}>
        <CodeEditor
          value={draft}
          onChange={setDraft}
          language="yaml"
          ariaLabel="Manifest YAML"
          minHeight={320}
          maxHeight={520}
          schemaValidate={(y) =>
            validateManifest(context, y).then((r) => (r.valid === false ? r.errors ?? [] : []))
          }
          schemaSource={(apiVersion, kind) =>
            openApiSchema(context, apiVersion, kind).then((r) => ("error" in r ? null : r))
          }
        />
      </Suspense>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <Button onClick={() => setConfirming(true)} disabled={!dirty}>
          <Upload data-icon="inline-start" />
          Apply
        </Button>
        <Button variant="ghost" onClick={() => setDraft(original)} disabled={!dirty}>
          <Undo2 data-icon="inline-start" />
          Reset
        </Button>
        {applied && !dirty && (
          <span className="fl-apply-success">
            <CircleCheck aria-hidden="true" /> Applied
          </span>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Apply manifest?"
          message={
            <>
              <p style={{ marginTop: 0 }}>
                Server-side apply the edited <code>{kind}</code> <code>{name}</code> to the cluster?
              </p>
              {applyError && (
                <p style={{ color: "var(--fl-color-danger)" }}>Error: {applyError}</p>
              )}
            </>
          }
          confirmLabel="Apply"
          busy={applying}
          onConfirm={() => void apply()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
