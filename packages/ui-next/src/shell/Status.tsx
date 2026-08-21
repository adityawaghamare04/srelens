import { useSyncExternalStore } from "react";
import { getForwards, subscribeForwards, type ClusterContext } from "@srelens/core";
import { StatusBar, type StatusSegment, type Tone } from "@srelens/ui-kit";
import { useConsole } from "../console";
import { useInfo } from "../lib/probe";
import { openTab, useActiveCluster } from "../lib/tabsStore";
import { useWorkspaceView, type LinkState } from "../lib/workspace";

/**
 * What the link says, in words. The mock said it in colour alone — a green dot
 * for connected, a red one for unreachable — which is no readout at all for
 * anyone who cannot separate the two. The kit's segment requires a string, so
 * the words are the readout and the tone is the second channel. "Unreachable"
 * rather than "Error" for `error`: the failure being reported is the cluster's,
 * not the app's, and the person reading it wants to know which. (#320)
 */
const LINK_WORD: Record<LinkState, string> = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
  error: "Unreachable",
};

const LINK_TONE: Record<LinkState, Tone> = {
  connected: "ok",
  connecting: "info",
  disconnected: "muted",
  error: "sev",
};

/**
 * The strip along the bottom of the window: which cluster this window is
 * looking at, what version it runs, whether it is reachable, how many
 * port-forwards are up, and the way in to the console.
 *
 * Every readout here is somebody else's fact — the tab store's active cluster,
 * the probe's version, the workspace view's link state, core's forwards — so
 * this component is only the place they meet. The kit draws them, and it is
 * not allowed to know what a cluster or a forward is, which is why they arrive
 * as segments rather than as props with those names on them.
 *
 * `contexts` is passed in rather than read from a store because the store holds
 * `stableId`s and the strip shows names: the id survives a rename and the name
 * is what a person recognises, and only the caller that listed the contexts can
 * turn one into the other.
 *
 * The forwards count comes straight off core's module-level store rather than
 * through a hook of ours. It is shared with the per-resource "Forward" action
 * and must survive this component unmounting, so subscribing to it is the whole
 * of the wiring — a copy in ui-next would be a second answer to the same
 * question.
 */
export function Status({ contexts }: { contexts: ClusterContext[] }) {
  const activeId = useActiveCluster();
  const info = useInfo(activeId);
  const { links } = useWorkspaceView();
  const { setOpen } = useConsole();
  const forwards = useSyncExternalStore(subscribeForwards, getForwards, getForwards);

  // Found rather than assumed: the active id is persisted and the context list
  // is whatever the machine has now, so an id can outlive the context it named.
  const ctx = contexts.find((c) => c.stableId === activeId);
  // Nothing has probed yet, or there is nothing to probe. Either way the link
  // is not up, and "Disconnected" is the honest reading of that.
  const state = (activeId ? links[activeId]?.state : undefined) ?? "disconnected";
  const n = forwards.length;

  const segments: StatusSegment[] = [
    {
      id: "ctx",
      label: ctx?.name ?? "No cluster",
      dot: true,
      tone: LINK_TONE[state],
      // Pressable only when there is a cluster to open. A "No cluster" button
      // that opens an overview of nothing is a dead end dressed as a way out.
      onSelect: ctx ? () => openTab("/overview", { clusterName: ctx.name }) : undefined,
    },
  ];
  if (ctx) {
    // The probe may not have landed, and a reachable cluster can still report
    // no version. Both are "we do not know yet", said in words rather than by
    // dropping the readout — a segment that comes and goes moves the ones after
    // it along the strip every time a cluster is probed.
    segments.push({ id: "ver", label: info?.version ?? "version unknown" });
  }
  // Pulsing only while connecting: the dot is animated for a readout that is
  // still changing, not for one that merely happens to be current.
  segments.push({ id: "link", label: LINK_WORD[state], pulse: state === "connecting" });

  const end: StatusSegment[] = [
    {
      id: "pf",
      label: `${n} port-forward${n === 1 ? "" : "s"}`,
      tone: "info",
      // A dot for "something is running", so the strip reads as live at a
      // glance; none at zero, where there is nothing to be live about.
      dot: n > 0,
      onSelect: () => openTab("/forwards"),
    },
    { id: "ask", label: "Ask", tone: "accent", onSelect: () => setOpen(true) },
  ];

  return <StatusBar segments={segments} end={end} />;
}
