/**
 * Adapted from OpenClaw (MIT) — src/infra/exec-allowlist-pattern.ts
 * https://github.com/openclaw/openclaw
 *
 * Parses execution allowlist patterns for approval policy checks.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const GLOB_REGEX_CACHE_LIMIT = 256;
const globRegexCache = new Map();

function escapeRegExpLiteral(ch) {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandHomePrefix(value) {
  if (!value.startsWith("~")) return value;
  const home = os.homedir();
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(home, value.slice(2));
  }
  return value;
}

function normalizeMatchTarget(value) {
  let normalized = value.replace(/\\/g, "/");
  if (process.platform === "darwin" && normalized.startsWith("/private/")) {
    return normalized.slice("/private".length);
  }
  return normalized;
}

function tryRealpath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function hasDotPathSegment(value) {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment === "." || segment === "..");
}

function normalizeDotPathSegments(value) {
  const normalized =
    process.platform === "win32" ? path.win32.normalize(value) : path.posix.normalize(value);
  return normalizeMatchTarget(normalized);
}

function compileGlobRegex(pattern) {
  const cacheKey = `${process.platform}:${pattern}`;
  const cached = globRegexCache.get(cacheKey);
  if (cached) return cached;

  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern.charAt(i);
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      regex += "[^/]";
      i += 1;
      continue;
    }
    regex += escapeRegExpLiteral(ch);
    i += 1;
  }
  regex += "$";

  const compiled = new RegExp(regex, process.platform === "win32" ? "i" : "");
  if (globRegexCache.size >= GLOB_REGEX_CACHE_LIMIT) globRegexCache.clear();
  globRegexCache.set(cacheKey, compiled);
  return compiled;
}

export function matchesExecAllowlistPattern(pattern, target) {
  const trimmed = String(pattern || "").trim();
  if (!trimmed) return false;

  const expanded = trimmed.startsWith("~") ? expandHomePrefix(trimmed) : trimmed;
  const hasWildcard = /[*?]/.test(expanded);
  let normalizedPattern = expanded;
  let normalizedTarget = target;
  if (process.platform === "win32" && !hasWildcard) {
    normalizedPattern = tryRealpath(expanded) ?? expanded;
    normalizedTarget = tryRealpath(target) ?? target;
  }
  normalizedPattern = normalizeMatchTarget(normalizedPattern);
  normalizedTarget = normalizeMatchTarget(normalizedTarget);
  if (hasWildcard && hasDotPathSegment(normalizedTarget)) {
    normalizedTarget = normalizeDotPathSegments(normalizedTarget);
  }
  return compileGlobRegex(normalizedPattern).test(normalizedTarget);
}

/**
 * True if command string matches any exec allowlist pattern
 * (exact token or glob against full command / cwd paths).
 */
export function commandMatchesExecAllowlist(command, patterns = [], opts = {}) {
  if (!patterns.length) return true; // open if unset
  const cmd = String(command || "").trim();
  const cwd = opts.cwd || process.cwd();
  for (const pat of patterns) {
    if (matchesExecAllowlistPattern(pat, cmd)) return true;
    if (matchesExecAllowlistPattern(pat, path.join(cwd, cmd))) return true;
    // first token (binary name)
    const bin = cmd.split(/\s+/)[0];
    if (bin && matchesExecAllowlistPattern(pat, bin)) return true;
  }
  return false;
}
