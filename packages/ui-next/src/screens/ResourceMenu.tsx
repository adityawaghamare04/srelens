import { useState, type ReactNode } from "react";
import {
  copyKubectlCommand,
  cronjobSetSuspend,
  cronjobTriggerNow,
  deleteResource,
  evictPod,
  notify,
  rolloutRestart,
  scaleResource,
  toKubectl,
  type KubectlInput,
} from "@srelens/core";
import { ConfirmDialog, KubectlPreview, TextInput, type ContextMenuItem } from "@srelens/ui-kit";
import { Icons } from "../lib/icons";
import type { KindActions, ListRow } from "../lib/kinds/types";
import { openTab } from "../lib/tabsStore";

export interface UseRowMenuArgs {
  /** The kubeconfig context name — what every core action call is scoped to. */
  context: string;
  /** The Kubernetes kind this list is showing, e.g. "Pod", "CronJob". */
  kind: string;
  actions: KindActions;
}

/** What a picked entry is waiting to do, once the confirm is taken. */
type Pending =
  | { type: "delete"; row: ListRow }
  | { type: "scale"; row: ListRow }
  | { type: "restart"; row: ListRow }
  | { type: "evict"; row: ListRow }
  /** `suspend: true` sets the CronJob suspended; `false` resumes it. */
  | { type: "suspend"; row: ListRow; suspend: boolean };

/** `CronJobSummary` carries `suspended`; a bare `ListRow` doesn't promise it. */
function isSuspended(row: ListRow): boolean {
  const value = (row as { suspended?: unknown }).suspended;
  return typeof value === "boolean" && value;
}

const nav = (name: string, suffix?: string) =>
  `/resources/${encodeURIComponent(name)}${suffix ? `/${suffix}` : ""}`;

/**
 * The row menu and the one dialog every write action in it shares.
 *
 * One hook rather than two exports: the items close over the row that was
 * picked, the dialog renders wherever the caller puts it (outside the table,
 * so it isn't clipped by a scrolling body), and a caller wiring only one of
 * the two would get a menu that opens nothing or a dialog nothing opens.
 *
 * Every destructive pick — Scale, Restart rollout, Evict, Delete — sets
 * `pending` rather than acting; only `onConfirm` calls core. That is what
 * makes "no write happens without a confirm" true by construction rather than
 * by every call site remembering to check. Suspend/Resume also goes through
 * `pending` (it is a real write with a kubectl equivalent) but is never
 * `danger`, and Run now skips `pending` entirely — it is a call, not a
 * mutation of anything already running.
 */
export function useRowMenu({ context, kind, actions }: UseRowMenuArgs): {
  items: (row: ListRow) => ContextMenuItem[];
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [replicas, setReplicas] = useState("");

  function open(next: Pending) {
    setError("");
    if (next.type === "scale") setReplicas("");
    setPending(next);
  }

  function close() {
    setPending(null);
    setError("");
  }

  async function runNow(row: ListRow) {
    const out = await cronjobTriggerNow(context, row.namespace ?? "", row.name);
    if (out.error) {
      notify.error(`Failed to run ${row.name}`, out.error);
      return;
    }
    notify.success(`Triggered ${row.name}`, out.jobName ? `Created job ${out.jobName}` : undefined);
  }

  async function confirm() {
    if (!pending) return;
    const { row } = pending;
    const ns = row.namespace ?? "";

    if (pending.type === "scale") {
      const n = Number(replicas);
      if (replicas.trim() === "" || !Number.isInteger(n) || n < 0) {
        setError("Enter a non-negative replica count.");
        return;
      }
    }

    setBusy(true);
    setError("");
    const result = await (async () => {
      switch (pending.type) {
        case "delete":
          return deleteResource(context, kind, row.namespace ?? null, row.name);
        case "scale":
          return scaleResource(context, kind, ns, row.name, Number(replicas));
        case "restart":
          return rolloutRestart(context, kind, ns, row.name);
        case "evict":
          return evictPod(context, ns, row.name);
        case "suspend":
          return cronjobSetSuspend(context, ns, row.name, pending.suspend);
      }
    })();
    setBusy(false);

    // A rejected or error-returning call leaves the dialog up with the
    // message in it, rather than closing as if the write had happened.
    if (result.error) {
      setError(result.error);
      return;
    }
    close();
  }

  function items(row: ListRow): ContextMenuItem[] {
    const ns = row.namespace ?? "";
    const kubectlBase: Omit<KubectlInput, "action"> = { kind, name: row.name, namespace: ns || null, context };

    const list: ContextMenuItem[] = [
      { label: "Open in new tab", onPick: () => openTab(nav(row.name), { clusterName: context }) },
    ];
    if (actions.logs) {
      list.push({ label: "Follow logs", icon: Icons.logs, onPick: () => openTab(nav(row.name, "logs"), { clusterName: context }) });
    }
    if (actions.shell) {
      list.push({ label: "Open shell", icon: Icons.terminal, onPick: () => openTab(nav(row.name, "shell"), { clusterName: context }) });
    }
    if (actions.forward) {
      list.push({
        label: "Port forward",
        icon: Icons.portforwards,
        onPick: () => openTab(nav(row.name, "forward"), { clusterName: context }),
      });
    }
    list.push({ label: "Edit", onPick: () => openTab(`/edit/${encodeURIComponent(row.name)}`, { clusterName: context }) });
    list.push({
      label: "Copy as kubectl",
      icon: Icons.copy,
      onPick: () => void copyKubectlCommand(toKubectl({ ...kubectlBase, action: "get", output: "yaml" })),
    });

    if (actions.suspend) {
      const suspended = isSuspended(row);
      list.push({
        label: suspended ? "Resume" : "Suspend",
        onPick: () => open({ type: "suspend", row, suspend: !suspended }),
      });
    }
    if (actions.trigger) {
      list.push({ label: "Run now", onPick: () => void runNow(row) });
    }

    // The destructive group. Every entry in it sets `danger` — shipping only
    // Delete as danger was a real bug caught on the tab menu (#335); the same
    // review finding applies here, in a second menu.
    const destructive: ContextMenuItem[] = [];
    if (actions.scale) {
      destructive.push({ label: "Scale", danger: true, onPick: () => open({ type: "scale", row }) });
    }
    if (actions.restart) {
      destructive.push({ label: "Restart rollout", danger: true, onPick: () => open({ type: "restart", row }) });
    }
    if (actions.evict) {
      destructive.push({ label: "Evict", danger: true, onPick: () => open({ type: "evict", row }) });
    }
    destructive.push({ label: "Delete", danger: true, onPick: () => open({ type: "delete", row }) });
    if (destructive.length) list.push({ kind: "sep" }, ...destructive);

    return list;
  }

  const dialog = pending ? <PendingDialog pending={pending} kind={kind} context={context} busy={busy} error={error} replicas={replicas} onReplicasChange={setReplicas} onConfirm={() => void confirm()} onCancel={close} /> : null;

  return { items, dialog };
}

const TITLES: Record<Pending["type"], (kind: string) => string> = {
  delete: (kind) => `Delete ${kind}?`,
  scale: (kind) => `Scale ${kind}`,
  restart: (kind) => `Restart ${kind}`,
  evict: () => "Evict pod?",
  suspend: () => "", // overridden per-instance, below — the label depends on direction
};

function messageFor(pending: Pending): ReactNode {
  const { row } = pending;
  const where = row.namespace ? (
    <>
      {" "}
      in <code>{row.namespace}</code>
    </>
  ) : null;
  switch (pending.type) {
    case "delete":
      return (
        <>
          Delete <code>{row.name}</code>
          {where}? This cannot be undone.
        </>
      );
    case "scale":
      return (
        <>
          Set the replica count for <code>{row.name}</code>
          {where}.
        </>
      );
    case "restart":
      return (
        <>
          Trigger a rolling restart of <code>{row.name}</code>
          {where}? This reschedules all of its pods.
        </>
      );
    case "evict":
      return (
        <>
          Gracefully evict <code>{row.name}</code>
          {where} (respects disruption budgets)?
        </>
      );
    case "suspend":
      return (
        <>
          {pending.suspend ? "Suspend" : "Resume"} <code>{row.name}</code>
          {where}?{" "}
          {pending.suspend
            ? "Scheduled runs will be paused; already-running jobs are unaffected."
            : "Scheduled runs will resume."}
        </>
      );
  }
}

function kubectlFor(pending: Pending, kind: string, context: string, replicas: string): { command?: string; note?: string } {
  const { row } = pending;
  const namespace = row.namespace ?? null;
  switch (pending.type) {
    case "delete":
      return { command: toKubectl({ action: "delete", kind, name: row.name, namespace, context }) };
    case "restart":
      return { command: toKubectl({ action: "rollout-restart", kind, name: row.name, namespace, context }) };
    case "evict":
      return {
        note: "No single-line kubectl equivalent — eviction uses the pod's /eviction subresource, which respects PodDisruptionBudgets (a plain delete does not).",
      };
    case "suspend":
      return {
        command: toKubectl({
          action: pending.suspend ? "cronjob-suspend" : "cronjob-resume",
          kind,
          name: row.name,
          namespace,
          context,
        }),
      };
    case "scale": {
      const n = Number(replicas);
      if (replicas.trim() === "" || !Number.isInteger(n) || n < 0) return {};
      return { command: toKubectl({ action: "scale", kind, name: row.name, namespace, context, replicas: n }) };
    }
  }
}

function PendingDialog({
  pending,
  kind,
  context,
  busy,
  error,
  replicas,
  onReplicasChange,
  onConfirm,
  onCancel,
}: {
  pending: Pending;
  kind: string;
  context: string;
  busy: boolean;
  error: string;
  replicas: string;
  onReplicasChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const title = pending.type === "suspend" ? (pending.suspend ? "Suspend CronJob" : "Resume CronJob") : TITLES[pending.type](kind);
  const confirmLabel =
    pending.type === "delete"
      ? "Delete"
      : pending.type === "scale"
        ? "Scale"
        : pending.type === "restart"
          ? "Restart"
          : pending.type === "evict"
            ? "Evict"
            : pending.suspend
              ? "Suspend"
              : "Resume";
  const { command, note } = kubectlFor(pending, kind, context, replicas);

  return (
    <ConfirmDialog
      title={title}
      // Suspend/resume is a write with no danger styling (R-4 of the CronJob
      // ruling); every other entry that reaches this dialog is destructive.
      danger={pending.type !== "suspend"}
      busy={busy}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p style={{ marginTop: 0 }}>{messageFor(pending)}</p>
          {pending.type === "scale" && (
            <TextInput
              value={replicas}
              onValueChange={onReplicasChange}
              placeholder="replicas"
              aria-label="Replica count"
              invalid={Boolean(error)}
              autoFocus
            />
          )}
          <KubectlPreview command={command} note={note} onCopy={command ? () => void copyKubectlCommand(command) : undefined} />
          {error && <p style={{ color: "var(--sev)" }}>Error: {error}</p>}
        </>
      }
    />
  );
}
