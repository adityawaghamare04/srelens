// Per-context settings are keyed by a stable id, not by the name on screen
// (#265).
//
// A context's display name is presentation only: it gains a `file/` prefix the
// moment another kubeconfig declares the same context name. So adding an
// unrelated file renames a context the user never touched, and everything keyed
// by that name — identity, hotbar order, remembered namespace, saved forwards,
// open tabs — silently stops matching. The backend's `stableId` (the declaring
// file plus the context's name inside it) does not move.

/** The identifying pair the backend sends for every context. */
export interface ContextIdentity {
  /** Display name; may gain a `file/` prefix when names collide. */
  name: string;
  /** Identity that survives that rename. */
  stableId: string;
}

/**
 * The context's own name, with any disambiguating `file/` prefix removed.
 *
 * Derived from the display name rather than parsed out of `stableId`: both a
 * file path and a context name may legitimately contain `#`, so splitting the
 * id is ambiguous, whereas the prefix is always the segment before the last
 * `/` that the resolver added.
 */
export function unprefixedName(displayName: string): string {
  const slash = displayName.lastIndexOf("/");
  return slash === -1 ? displayName : displayName.slice(slash + 1);
}

/**
 * Find the context a stored key referred to when it was written.
 *
 * Tries the display name first, then the un-prefixed name — which recovers
 * settings for anyone who hit the collision *before* upgrading, since their
 * key was written under the pre-rename name. The fallback only applies when
 * exactly one context matches: with several, the original owner is genuinely
 * unknowable and guessing would hand one context another's identity.
 */
export function resolveStoredKey(
  key: string,
  contexts: readonly ContextIdentity[],
): ContextIdentity | null {
  const byDisplay = contexts.filter((context) => context.name === key);
  if (byDisplay.length === 1) return byDisplay[0];
  if (byDisplay.length > 1) return null;

  const byOriginal = contexts.filter((context) => unprefixedName(context.name) === key);
  return byOriginal.length === 1 ? byOriginal[0] : null;
}

/**
 * Rekey a name-keyed record onto stable ids. Entries already keyed by a stable
 * id, and entries whose context can't be identified, are left untouched — a
 * context that is simply not connected right now must not lose its settings.
 */
export function migrateRecordKeys<T>(
  stored: Readonly<Record<string, T>>,
  contexts: readonly ContextIdentity[],
): { migrated: Record<string, T>; changed: boolean } {
  const ids = new Set(contexts.map((context) => context.stableId));
  const result: Record<string, T> = {};
  let changed = false;

  for (const [key, value] of Object.entries(stored)) {
    if (ids.has(key)) {
      result[key] = value;
      continue;
    }
    const owner = resolveStoredKey(key, contexts);
    // Never overwrite an id-keyed entry that already exists: it was written
    // under the new scheme and is therefore the more recent truth.
    if (owner && !(owner.stableId in stored) && !(owner.stableId in result)) {
      result[owner.stableId] = value;
      changed = true;
    } else {
      result[key] = value;
    }
  }
  return { migrated: result, changed };
}

/** Rekey an ordered list of context names onto stable ids, preserving order. */
export function migrateOrder(
  order: readonly string[],
  contexts: readonly ContextIdentity[],
): { migrated: string[]; changed: boolean } {
  const ids = new Set(contexts.map((context) => context.stableId));
  const migrated: string[] = [];
  let changed = false;

  for (const key of order) {
    if (ids.has(key)) {
      migrated.push(key);
      continue;
    }
    const owner = resolveStoredKey(key, contexts);
    if (owner && !migrated.includes(owner.stableId)) {
      migrated.push(owner.stableId);
      changed = true;
    } else if (!owner) {
      // Keep an unrecognized entry: the context may just be disconnected, and
      // dropping it would silently reorder the user's hotbar.
      migrated.push(key);
    }
  }
  return { migrated, changed };
}

/**
 * Project an id-keyed store into the name-keyed shape the UI renders from.
 *
 * Components keep their simple "look it up by the name on screen" API; only
 * the durable layer is keyed by identity. Contexts that aren't currently
 * connected have no display name, so they are absent here — see
 * {@link mergeFromNames} for why that doesn't lose them.
 */
export function projectToNames<T>(
  byId: Readonly<Record<string, T>>,
  contexts: readonly ContextIdentity[],
): Record<string, T> {
  const byName: Record<string, T> = {};
  for (const context of contexts) {
    const value = byId[context.stableId];
    if (value !== undefined) byName[context.name] = value;
  }
  return byName;
}

/**
 * Fold an edited name-keyed map back into the id-keyed store.
 *
 * Merged rather than replaced, deliberately: the name-keyed view only contains
 * connected contexts, so replacing the store with it would delete the settings
 * of every cluster that happens to be disconnected right now.
 */
export function mergeFromNames<T>(
  byId: Readonly<Record<string, T>>,
  byName: Readonly<Record<string, T>>,
  contexts: readonly ContextIdentity[],
): Record<string, T> {
  const merged: Record<string, T> = { ...byId };
  const idOf = new Map(contexts.map((context) => [context.name, context.stableId]));
  // Entries the UI dropped for a CONNECTED context are genuine deletions.
  for (const context of contexts) {
    if (!(context.name in byName)) delete merged[context.stableId];
  }
  for (const [name, value] of Object.entries(byName)) {
    const id = idOf.get(name);
    if (id) merged[id] = value;
  }
  return merged;
}

/** Project an id-keyed order into display names, dropping anything offline. */
export function projectOrderToNames(
  orderById: readonly string[],
  contexts: readonly ContextIdentity[],
): string[] {
  const nameOf = new Map(contexts.map((context) => [context.stableId, context.name]));
  return orderById.map((id) => nameOf.get(id)).filter((name): name is string => !!name);
}

/**
 * Fold a reordered list of display names back into the id-keyed order.
 *
 * Offline contexts are absent from the UI's list, so they are re-appended
 * rather than dropped — otherwise reordering the hotbar while a cluster is
 * disconnected would silently forget where it sat.
 */
export function mergeOrderFromNames(
  orderById: readonly string[],
  orderByName: readonly string[],
  contexts: readonly ContextIdentity[],
): string[] {
  const idOf = new Map(contexts.map((context) => [context.name, context.stableId]));
  const reordered = orderByName
    .map((name) => idOf.get(name))
    .filter((id): id is string => !!id);
  const seen = new Set(reordered);
  const offline = orderById.filter((id) => !seen.has(id) && !idOf.has(id));
  return [...reordered, ...offline];
}
