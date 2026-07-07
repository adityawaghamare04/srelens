// Small persisted-settings helpers (localStorage). Survives app restarts.

const CLUSTER_NS_KEY = "srelens.clusterNamespaces";
const DEFAULT_NS_KEY = "srelens.defaultNamespace";
const WORKSPACE_LAYOUT_KEY = "srelens.workspaceLayout";
const CONTEXT_PROFILES_KEY = "srelens.contextProfiles";
const KUBECONFIG_FILES_KEY = "srelens.kubeconfigFiles";
const CONTEXT_ORDER_KEY = "srelens.contextOrder";
const REQUEST_TIMEOUT_KEY = "srelens.requestTimeoutSecs";
const LEGACY_PREFIX = "free" + "lens";

/** Per-request timeout budget (connect + list/get/apply), in seconds. */
export const REQUEST_TIMEOUT = { MIN: 1, MAX: 30, DEFAULT: 8 } as const;

/** Clamp any value to the supported timeout range; fall back to the default. */
export function clampTimeoutSecs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return REQUEST_TIMEOUT.DEFAULT;
  return Math.round(Math.max(REQUEST_TIMEOUT.MIN, Math.min(REQUEST_TIMEOUT.MAX, n)));
}

/** The persisted request timeout in seconds, or the default when unset/invalid. */
export function getRequestTimeoutSecs(): number {
  try {
    const raw = stored(REQUEST_TIMEOUT_KEY);
    return raw === null ? REQUEST_TIMEOUT.DEFAULT : clampTimeoutSecs(JSON.parse(raw));
  } catch {
    return REQUEST_TIMEOUT.DEFAULT;
  }
}

/** Persist the request timeout (clamped). Returns the clamped value stored. */
export function setRequestTimeoutSecs(secs: number): number {
  const clamped = clampTimeoutSecs(secs);
  try {
    localStorage.setItem(REQUEST_TIMEOUT_KEY, JSON.stringify(clamped));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
  return clamped;
}

function stored(key: string): string | null {
  return localStorage.getItem(key) ?? localStorage.getItem(key.replace("srelens", LEGACY_PREFIX));
}

export type ContextLogo = "initials" | "cluster" | "cloud" | "shield" | "database" | "globe" | "custom";

export interface ContextProfile {
  displayName?: string;
  shortName?: string;
  color?: string;
  logo?: ContextLogo;
  logoUrl?: string;
}

export type ContextProfiles = Record<string, ContextProfile>;

export interface WorkspaceLayoutSettings {
  leftSidebarWidth: number;
  rightSidebarWidth: number;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutSettings = {
  leftSidebarWidth: 208,
  rightSidebarWidth: 480,
};

function boundedWidth(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)))
    : fallback;
}

/** Last-selected namespace per cluster, remembered across restarts. */
export function loadClusterNamespaces(): Record<string, string> {
  try {
    const raw = stored(CLUSTER_NS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveClusterNamespaces(map: Record<string, string>): void {
  try {
    localStorage.setItem(CLUSTER_NS_KEY, JSON.stringify(map));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

/** Global fallback namespace for a cluster with no remembered selection ("" = all). */
export function getDefaultNamespace(): string {
  try {
    return stored(DEFAULT_NS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDefaultNamespace(ns: string): void {
  try {
    localStorage.setItem(DEFAULT_NS_KEY, ns);
  } catch {
    // ignore
  }
}

export function loadWorkspaceLayout(): WorkspaceLayoutSettings {
  try {
    const raw = stored(WORKSPACE_LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_WORKSPACE_LAYOUT };
    const value = JSON.parse(raw) as Partial<WorkspaceLayoutSettings>;
    return {
      leftSidebarWidth: boundedWidth(value.leftSidebarWidth, DEFAULT_WORKSPACE_LAYOUT.leftSidebarWidth, 160, 420),
      rightSidebarWidth: boundedWidth(value.rightSidebarWidth, DEFAULT_WORKSPACE_LAYOUT.rightSidebarWidth, 320, 960),
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_LAYOUT };
  }
}

export function saveWorkspaceLayout(layout: WorkspaceLayoutSettings): void {
  try {
    localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function loadContextProfiles(): ContextProfiles {
  try {
    const raw = stored(CONTEXT_PROFILES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ContextProfiles;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveContextProfiles(profiles: ContextProfiles): void {
  try {
    localStorage.setItem(CONTEXT_PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function contextDisplayName(context: string, profile?: ContextProfile): string {
  return profile?.displayName?.trim() || context;
}

export function loadKubeconfigFiles(): string[] {
  try {
    const parsed = JSON.parse(stored(KUBECONFIG_FILES_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((path): path is string => typeof path === "string" && path.trim().length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function saveKubeconfigFiles(paths: string[]): void {
  try {
    localStorage.setItem(KUBECONFIG_FILES_KEY, JSON.stringify([...new Set(paths)]));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function loadContextOrder(): string[] {
  try {
    const parsed = JSON.parse(stored(CONTEXT_ORDER_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((name): name is string => typeof name === "string" && name.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function saveContextOrder(order: string[]): void {
  try {
    localStorage.setItem(CONTEXT_ORDER_KEY, JSON.stringify([...new Set(order)]));
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

/** Which release channel the in-app updater follows. */
export type UpdateChannel = "stable" | "dev";

const UPDATE_CHANNEL_KEY = "srelens.updateChannel";

export function loadUpdateChannel(): UpdateChannel {
  try {
    const value = stored(UPDATE_CHANNEL_KEY);
    return value === "dev" ? "dev" : "stable";
  } catch {
    return "stable";
  }
}

export function saveUpdateChannel(channel: UpdateChannel): void {
  try {
    localStorage.setItem(UPDATE_CHANNEL_KEY, channel);
  } catch {
    // ignore unavailable/quota-exceeded storage
  }
}

export function orderContexts<T extends { name: string }>(contexts: T[], order: string[]): T[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return contexts
    .map((context, index) => ({ context, index }))
    .sort((left, right) => {
      const leftRank = rank.get(left.context.name);
      const rightRank = rank.get(right.context.name);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return left.index - right.index;
    })
    .map(({ context }) => context);
}
