import { useState } from "react";
import { ConfirmDialog, IconButton, Titlebar, WorkspaceSwitcher } from "@srelens/ui-kit";
import { applyUiScale, getUiScale, isTauri, setUiScale, stepUiScale } from "@srelens/core";
import { Icons } from "../lib/icons";
import { openTab, removeWorkspace, switchWorkspace, useTabs } from "../lib/tabsStore";

export interface ChromeProps {
  controls: "macos" | "none";
  /** The active cluster's display name — what this window is looking at. */
  clusterName?: string;
  onToggleTheme: () => void;
  /** The window owns the create dialog; the chip only asks for it. */
  onNewWorkspace: () => void;
}

/**
 * Read, stepped, stored and applied in one place.
 *
 * Exported because the titlebar is not the only thing that zooms: the window
 * binds Cmd/Ctrl +/-/0 to the same three actions, and two copies of this would
 * be two chances for the keyboard and the buttons to disagree about what a step
 * is or whether it was persisted. `setUiScale` clamps and returns what it
 * stored, so what gets applied is what was saved rather than what was asked
 * for — at the ends of the range those differ.
 */
export function zoom(action: "in" | "out" | "reset") {
  const next = setUiScale(stepUiScale(getUiScale(), action));
  applyUiScale(next);
}

/**
 * The bar across the top of the window: which workspace you are in, which
 * cluster this window is looking at, and the actions that act on the window.
 *
 * Everything visual is the kit's; what lives here is the wiring the kit is not
 * allowed to know — the tab store, the scale in core's settings, and the
 * decision about whether removing a workspace deserves a question.
 *
 * That decision is the only judgement in the file. Removing a workspace has no
 * undo and takes every tab in it, so it asks — except when there is nothing to
 * ask about. A workspace is seeded with exactly one tab, the pinned home tab it
 * is born with; confirming the loss of a tab that was never opened is a dialog
 * about nothing, and a dialog about nothing is what teaches people to dismiss
 * the ones that matter. So one tab removes outright and anything else confirms.
 *
 * The test is the count, deliberately, and not "every tab is pinned" — which is
 * what this first read as. Pinning is `togglePin`, a thing the user does to say
 * a tab matters, so a workspace whose tabs had all been pinned was the case
 * most worth asking about and the one that skipped the question: the tabs
 * someone had marked as worth keeping went silently, with no undo, on the exact
 * path the confirmation exists to guard.
 *
 * The zoom controls are desktop-only. `applyUiScale` asks the webview to zoom;
 * in web mode there is no webview to ask, the browser's own zoom already does
 * this, and three buttons that quietly do nothing are worse than three buttons
 * that are not there.
 */
export function Chrome({ controls, clusterName, onToggleTheme, onNewWorkspace }: ChromeProps) {
  const { workspace, workspaces } = useTabs();
  const [removing, setRemoving] = useState<string | null>(null);
  // Found rather than held, so the dialog reads the live workspace: the count
  // in its message would otherwise be whatever it was when the dialog opened.
  const target = workspaces.find((w) => w.id === removing) ?? null;
  const desktop = isTauri();

  function askRemove(id: string) {
    const w = workspaces.find((x) => x.id === id);
    if (!w) return;
    if (w.tabs.length <= 1) removeWorkspace(id);
    else setRemoving(id);
  }

  const openTabs = target ? target.tabs.length : 0;

  return (
    <>
      <Titlebar
        controls={controls}
        label="Window"
        leading={
          <WorkspaceSwitcher
            icon={Icons.workspace}
            workspaces={workspaces.map((w) => ({
              id: w.id,
              name: w.name,
              clusters: w.clusters.length,
              tabs: w.tabs.length,
            }))}
            activeId={workspace.id}
            onSelect={switchWorkspace}
            onRemove={askRemove}
            onCreate={onNewWorkspace}
          />
        }
        title={clusterName ?? "srelens"}
        actions={
          <>
            {desktop && <IconButton icon={Icons.zoomOut} label="Zoom out" onClick={() => zoom("out")} />}
            {desktop && <IconButton icon={Icons.zoomReset} label="Reset zoom" onClick={() => zoom("reset")} />}
            {desktop && <IconButton icon={Icons.zoomIn} label="Zoom in" onClick={() => zoom("in")} />}
            <IconButton icon={Icons.sun} label="Theme" onClick={onToggleTheme} />
            <IconButton icon={Icons.settings} label="Appearance settings" onClick={() => openTab("/settings")} />
          </>
        }
      />
      {target && (
        <ConfirmDialog
          title={`Remove ${target.name}?`}
          message={`${openTabs} open ${openTabs === 1 ? "tab" : "tabs"} in this workspace will close. The clusters stay in your kubeconfig.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            removeWorkspace(target.id);
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </>
  );
}
