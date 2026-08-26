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

/**
 * Email sender allowlist check — WHO may command the bot over email.
 *
 * Entries may be a full address ("alice@corp.com") or a bare domain
 * ("corp.com"); a bare-domain entry matches that domain OR any subdomain of it,
 * tested against the address's DOMAIN part only — NEVER as a substring. So
 * "corp.com" must NOT admit "x@corp.com.evil.com" (suffix), "x@evil-corp.com"
 * (no dot boundary), or "corp.company@x.com" (substring in local part). Empty or
 * absent list is open (preserves the prior "no allowFrom = accept all"
 * behavior); "*" allows all. Full-address entries match exactly.
 */
export function isEmailSenderAllowed(allowFrom, fromAddr) {
  const entries = normalizeStringEntries(allowFrom || []).map((e) => e.toLowerCase());
  if (entries.length === 0) return true;
  if (entries.includes("*")) return true;
  const addr = String(fromAddr || "").trim().toLowerCase();
  if (!addr) return false;
  const at = addr.lastIndexOf("@");
  const domain = at >= 0 ? addr.slice(at + 1) : "";
  for (const e of entries) {
    if (e.includes("@")) {
      if (addr === e) return true; // full-address entry: exact match
    } else if (domain && (domain === e || domain.endsWith("." + e))) {
      return true; // bare-domain entry: exact domain or a subdomain of it
    }
  }
  return false;
}

export function formatAllowFromLowercase(params = {}) {
  return normalizeStringEntries(params.allowFrom || [])
    .map((entry) =>
      params.stripPrefixRe ? entry.replace(params.stripPrefixRe, "") : entry
    )
    .map((entry) => entry.toLowerCase())
    .filter(Boolean);
}
