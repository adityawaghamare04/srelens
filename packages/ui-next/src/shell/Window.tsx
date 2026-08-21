import { useEffect, useState } from "react";
import { listContexts, type ClusterContext } from "@srelens/core";
import { LoadingState, TabStrip } from "@srelens/ui-kit";
import { defaultState, reconcile } from "../lib/tabs";
import { flushSave, installFlushOnUnload, loadTabsState, scheduleSave } from "../lib/tabsPersist";
import { activateTab, closeTab, getState, newTab, setState, subscribe, useTabs } from "../lib/tabsStore";
import { Body } from "./Body";
import { TabSurface } from "./TabSurface";

export interface WindowProps {
  /** Display names of the screens that exist in the new design. */
  ported: string[];
  onOpenInClassic: (route: string) => void;
  /** Handed to every Placeholder; see its doc comment for why it lives there. */
  onOpenGallery?: () => void;
}

/**
 * The new design's window: the tab strip over the tab bodies. PR 1 of the
 * shell — the rail, sidebar, titlebar, status bar and console arrive in PR 2,
 * each composed around this.
 *
 * Boot reads the saved tabs and the cluster list together, then either
 * reconciles the one against the other or builds a Default workspace from the
 * clusters. Nothing renders until that resolves: a flash of last session's
 * tabs being replaced by this session's would read as the app losing work.
 */
export function Window({ ported, onOpenInClassic, onOpenGallery }: WindowProps) {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Whatever happens in here, boot has to finish: an exception escaping
      // this IIFE left `booted` false forever, so the window was a spinner —
      // no tabs, no Placeholder, and no way back to classic. A user whose
      // storage refuses reads gets a fresh workspace, not a dead window.
      // The contexts are read first so that `found` is already filled if the
      // saved state is what fails: the fallback is then a Default workspace
      // over the user's real clusters rather than an empty rail.
      let found: ClusterContext[] = [];
      try {
        const outcome = await listContexts();
        if (cancelled) return;
        found = outcome.contexts ?? [];
        const saved = loadTabsState();
        if (saved && outcome.error) {
          // The list failed, not the clusters: reconciling against nothing would
          // strip every workspace's cluster ids and the next change would persist
          // that. Trust the disk until the backend answers.
          setState(saved);
        } else {
          setState(saved ? reconcile(saved, found) : defaultState(found));
        }
      } catch (error) {
        if (cancelled) return;
        console.error("could not restore the workspaces", error);
        setState(defaultState(found));
      }
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist only once booted, or the empty pre-boot state would be written
  // over the real one on the way in.
  useEffect(() => {
    if (!booted) return;
    const off = subscribe(() => scheduleSave(getState()));
    const offUnload = installFlushOnUnload();
    return () => {
      off();
      offUnload();
      // Unmounting is the other way this window ends, and `beforeunload` does
      // not fire for it: a design switch, or the gallery going up, would
      // otherwise throw away up to a debounce interval of changes.
      flushSave();
    };
  }, [booted]);

  const { tabs, activeId } = useTabs();

  if (!booted) return <LoadingState label="Loading" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        onSelect={activateTab}
        onClose={closeTab}
        // No cluster name: `contexts[0]` is whichever context the kubeconfig
        // lists first, which is neither the current cluster nor necessarily
        // one in this workspace, and `TabStrip` reads `sub` into the tab's
        // accessible name. PR 2 wires the active cluster from `lib/workspace`.
        onNew={() => newTab("/")}
        label="Open tabs"
      />
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TabSurface key={tab.id} visible={tab.id === activeId}>
            <Body
              route={tab.route}
              clusterName={tab.sub}
              ported={ported}
              onOpenInClassic={onOpenInClassic}
              onOpenGallery={onOpenGallery}
            />
          </TabSurface>
        ))}
      </div>
    </div>
  );
}
