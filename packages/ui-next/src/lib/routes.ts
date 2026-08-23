import type { ComponentType } from "react";
import { K8S_KIND, RESOURCE_LABELS, type ResourceKind } from "@srelens/core";
import { parseDetailRoute } from "./detailRoute";
import { AppLog } from "../screens/AppLog";
import { ReleaseNotes } from "../screens/ReleaseNotes";
import { ResourceDetailScreen, Resources } from "../screens/Resources";
import { Workloads } from "../screens/Workloads";

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
    const [, , rawName, suffix] = route.split("/");
    const name = decodeURIComponent(rawName ?? "");
    // The row menu (`ResourceMenu.tsx`) mints `/resources/<name>/logs|shell|forward`
    // alongside the bare `/resources/<name>` — same prefix, so without this a
    // pod opened three ways ("Open in new tab", "Follow logs", "Open shell")
    // got three tabs with the identical title and kind, indistinguishable in
    // the strip.
    if (suffix === "logs") return { route, title: `${name} · logs`, sub, kind: "logs" };
    if (suffix === "shell") return { route, title: `${name} · shell`, sub, kind: "terminal" };
    if (suffix === "forward") return { route, title: `${name} · forward`, sub, kind: "forwards" };
    return { route, title: name, sub, kind: "resource" };
  }
  if (route.startsWith("/edit/")) {
    return { route, title: `Edit ${decodeURIComponent(route.split("/")[2] ?? "")}`, sub, kind: "edit" };
  }
  // A detail route (`/k/<kind>/<namespace>/<name>`) shares the `/k/` prefix
  // with a LIST route (`/k/<slug>`) — this must run before the list branch
  // below, or a detail route would fall into it and title itself after the
  // raw "<kind>/<namespace>/<name>" slug instead of the resource's own name.
  const detail = parseDetailRoute(route);
  if (detail) return { route, title: detail.name, sub, kind: "resource" };
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
  "/resources": Workloads,
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
  // A detail route (`/k/<kind>/<namespace>/<name>`, five segments) shares its
  // `/k/` prefix with a LIST route (`/k/<slug>`, three) — the more specific
  // match must win here, ahead of the prefix loop below, or a detail route
  // would render the LIST screen (`Resources`) as if the resource's own name
  // were just another kind slug. Matched by parse rather than by adding a
  // second `/k/` entry to `PREFIXED`, which cannot tell the two apart at all.
  if (parseDetailRoute(route)) return ResourceDetailScreen;
  for (const [prefix, screen] of PREFIXED) {
    // A bare prefix names no resource; `/k/` is not a route.
    if (route.startsWith(prefix) && route.length > prefix.length) return screen;
  }
  return null;
}
