/**
 * Adapted from OpenClaw (MIT) — src/channels/allow-from.ts
 * https://github.com/openclaw/openclaw
 *
 * Channel allowFrom policy helpers.
 */
export const ACCESS_GROUP_ALLOW_FROM_PREFIX = "accessGroup:";

export function normalizeStringEntries(entries = []) {
  const out = [];
  for (const e of entries) {
    if (e == null) continue;
    const s = String(e).trim();
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

export function parseAccessGroupAllowFromEntry(entry) {
  const trimmed = String(entry || "").trim();
  if (!trimmed.startsWith(ACCESS_GROUP_ALLOW_FROM_PREFIX)) return null;
  const name = trimmed.slice(ACCESS_GROUP_ALLOW_FROM_PREFIX.length).trim();
  return name.length > 0 ? name : null;
}

export function mergeDmAllowFromSources(params = {}) {
  const storeEntries =
    params.dmPolicy === "allowlist" || params.dmPolicy === "open"
      ? []
      : params.storeAllowFrom ?? [];
  return normalizeStringEntries([...(params.allowFrom ?? []), ...storeEntries]);
}

export function resolveGroupAllowFromSources(params = {}) {
  const explicitGroupAllowFrom =
    Array.isArray(params.groupAllowFrom) && params.groupAllowFrom.length > 0
      ? params.groupAllowFrom
      : undefined;
  const scoped = explicitGroupAllowFrom
    ? explicitGroupAllowFrom
    : params.fallbackToAllowFrom === false
      ? []
      : params.allowFrom ?? [];
  return normalizeStringEntries(scoped);
}

export function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Compile allowlist for fast checks.
 */
export function compileAllowlist(entries = []) {
  const normalized = normalizeStringEntries(entries).map((e) => e.toLowerCase());
  const hasWildcard = normalized.includes("*");
  return {
    entries: normalized,
    hasWildcard,
    hasEntries: normalized.length > 0,
  };
}

/**
 * Checks a normalized sender allowlist with wildcard and empty-list policy.
 * Adapted from OpenClaw isSenderIdAllowed.
 */
export function isSenderIdAllowed(allow, senderId, allowWhenEmpty = true) {
  if (!allow.hasEntries) return allowWhenEmpty;
  if (allow.hasWildcard) return true;
  if (!senderId) return false;
  const id = String(senderId).toLowerCase();
  return allow.entries.includes(id);
}

export function formatAllowFromLowercase(params = {}) {
  return normalizeStringEntries(params.allowFrom || [])
    .map((entry) =>
      params.stripPrefixRe ? entry.replace(params.stripPrefixRe, "") : entry
    )
    .map((entry) => entry.toLowerCase())
    .filter(Boolean);
}
