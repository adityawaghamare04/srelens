import type { ComponentType } from "react";
import { K8S_KIND, RESOURCE_LABELS, type ResourceKind } from "@srelens/core";
import { AppLog } from "../screens/AppLog";
import { ReleaseNotes } from "../screens/ReleaseNotes";
import { Resources } from "../screens/Resources";

/**
 * What a tab is about, for the strip's icon and for the context menu. The
 * mock's vocabulary, minus `components`, which is the gallery and not a tab.
 */
export type TabKind =
  | "control" | "incidents" | "agent" | "workloads" | "resource"
  | "logs" | "terminal" | "forwards" | "helm" | "toolbox" | "settings" | "connect"
  | "topology" | "connections" | "edit" | "events" | "applog" | "notes";

export interface RouteInfo {
  route: string;
  title: string;
  /** The cluster, for cluster-scoped routes. Absent for app-scoped ones. */
  sub?: string;
  kind: TabKind;
  pinned?: boolean;
}

/**
 * A `/k/<slug>` route is a built-in list when the slug is one of core's kinds.
 * `overview` is excluded: core lists it as a kind for the classic sidebar, but
 * it has no Kubernetes kind behind it (`K8S_KIND.overview === ""`) and lives at
 * `/overview` here.
 */
export function isBuiltInKind(slug: string): slug is ResourceKind {
  return slug !== "overview" && Object.prototype.hasOwnProperty.call(K8S_KIND, slug);
}

/**
 * Routes whose tab carries no cluster in its sub.
 *
 * Null-prototype, like every lookup below it: a route is a string that can
 * arrive from a persisted session or a resource name, and on a plain object
 * literal `APP_SCOPED["constructor"]` is `Object` — truthy, so the tab came
 * back with no title at all.
 */
const APP_SCOPED: Record<string, Omit<RouteInfo, "route" | "sub">> =
  Object.assign(Object.create(null), {
    "/applog": { title: "Application log", kind: "applog" },
    "/notes": { title: "Release notes", kind: "notes" },
    "/settings": { title: "Settings", kind: "settings" },
    "/connections": { title: "Connections", kind: "connections" },
    "/connect": { title: "Connect a cluster", kind: "connect" },
    "/toolbox": { title: "Toolbox", kind: "toolbox" },
  });

/** Routes whose tab names the cluster it is looking at. */
const CLUSTER_SCOPED: Record<string, Omit<RouteInfo, "route" | "sub">> =
  Object.assign(Object.create(null), {
    "/": { title: "Control room", kind: "control", pinned: true },
    "/incidents": { title: "Incidents", kind: "incidents" },
    "/agent": { title: "Agent", kind: "agent" },
    "/resources": { title: "Workloads", kind: "workloads" },
    "/logs": { title: "Logs", kind: "logs" },
    "/terminals": { title: "Shell", kind: "terminal" },
    "/forwards": { title: "Port forwards", kind: "forwards" },
    "/helm": { title: "Helm", kind: "helm" },
    "/topology": { title: "Topology", kind: "topology" },
    "/new": { title: "New resource", kind: "edit" },
    "/events": { title: "Events", kind: "events" },
    "/overview": { title: "Cluster overview", kind: "control" },
  });

/**
 * Turn a route into what its tab shows. The cluster name is the real one,
 * passed in by whoever knows it; the mock hard-coded "prod-eu".
 */
export function describe(route: string, clusterName?: string): RouteInfo {
  const sub = clusterName || undefined;
  if (route.startsWith("/resources/")) {
    return { route, title: decodeURIComponent(route.split("/")[2] ?? ""), sub, kind: "resource" };
  }
  if (route.startsWith("/edit/")) {
    return { route, title: `Edit ${decodeURIComponent(route.split("/")[2] ?? "")}`, sub, kind: "edit" };
  }
  if (route.startsWith("/k/")) {
    const slug = route.slice(3);
    const title = isBuiltInKind(slug) ? RESOURCE_LABELS[slug] : slug;
    return { route, title, sub, kind: "workloads" };
  }
  const app = APP_SCOPED[route];
  if (app) return { route, ...app };
  const cluster = CLUSTER_SCOPED[route];
  if (cluster) return { route, ...cluster, sub };
  return { route, title: route.replace(/^\//, "") || "Untitled", sub, kind: "control" };
}

export type ScreenComponent = ComponentType<{ route: string }>;

/**
 * The only place that knows which screens exist. Adding a screen is one entry
 * here and nothing else; a route with no entry renders the Placeholder.
 */
const SCREENS: Record<string, ScreenComponent> = Object.assign(Object.create(null), {
  "/applog": AppLog,
  "/notes": ReleaseNotes,
});

/**
 * Routes matched by prefix rather than by name, in order. Kept beside the
 * exact table rather than folded into it: a prefix table is a different kind of
 * claim — "everything under here" — and reading it as a list makes the reach of
 * each entry obvious. One screen answers all 34 built-in kinds and every CRD a
 * cluster has, so enumerating them here would be a second list to keep in step
 * with the sidebar's.
 */
const PREFIXED: ReadonlyArray<[string, ScreenComponent]> = [["/k/", Resources]];

export function screenFor(route: string): ScreenComponent | null {
  // `hasOwnProperty.call` as well as the null prototype: the table is the one
  // thing standing between an arbitrary route string and something rendered as
  // a component, and it costs nothing to say so twice.
  if (Object.prototype.hasOwnProperty.call(SCREENS, route)) return SCREENS[route];
  for (const [prefix, screen] of PREFIXED) {
    // A bare prefix names no resource; `/k/` is not a route.
    if (route.startsWith(prefix) && route.length > prefix.length) return screen;
  }
  return null;
}
