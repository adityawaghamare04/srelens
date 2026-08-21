import { useEffect, useState } from "react";
import { listContexts, type ClusterContext } from "@srelens/core";
import { LoadingState, TabStrip } from "@srelens/ui-kit";
import { defaultState, reconcile } from "../lib/tabs";
import { installFlushOnUnload, loadTabsState, scheduleSave } from "../lib/tabsPersist";
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
  const [contexts, setContexts] = useState<ClusterContext[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = loadTabsState();
      const outcome = await listContexts();
      if (cancelled) return;
      const found = outcome.contexts ?? [];
      setContexts(found);
      setState(saved ? reconcile(saved, found) : defaultState(found));
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
    };
  }, [booted]);

  const { tabs, activeId } = useTabs();
  const clusterName = contexts[0]?.name;

  if (!booted) return <LoadingState label="Loading" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip
        tabs={tabs}
        activeId={activeId}
        onSelect={activateTab}
        onClose={closeTab}
        onNew={() => newTab("/", clusterName)}
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
