/**
 * Adapted from OpenClaw (MIT) — src/infra/exec-allowlist-pattern.ts
 * https://github.com/openclaw/openclaw
 *
 * Parses execution allowlist patterns for approval policy checks.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanCommand } from "./risk.mjs";

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
 * True if a single command segment matches any allowlist pattern
 * (glob against the full segment, its cwd-joined form, or its binary name).
 */
function segmentMatchesAllowlist(segment, patterns, cwd) {
  const seg = String(segment || "").trim();
  if (!seg) return true; // empty segment (e.g. trailing separator) is a no-op
  const bin = seg.split(/\s+/)[0];
  for (const pat of patterns) {
    if (matchesExecAllowlistPattern(pat, seg)) return true;
    if (matchesExecAllowlistPattern(pat, path.join(cwd, seg))) return true;
    if (bin && matchesExecAllowlistPattern(pat, bin)) return true;
  }
  return false;
}

/**
 * True if a command is covered by the exec allowlist.
 *
 * A compound command (`a && b`, `a | b`, `a; b`) is only allowlisted when
 * EVERY segment is allowlisted — the old first-token check allowlisted
 * `safe-cmd && rm -rf /` on `safe-cmd` alone, letting the destructive tail
 * auto-run. Segmentation reuses the single quote-aware parser in risk.mjs
 * (one owner), and any construct it flags as unsafe (command substitution,
 * backticks, subshells, redirects, unterminated quotes) fails closed —
 * those cannot be reasoned about segment-by-segment, so they pend rather
 * than auto-approve.
 *
 * Note there is deliberately no whole-command fast path: a wildcard pattern
 * like `ls*` compiles to `ls[^/]*` and would otherwise swallow an entire
 * compound (`ls | curl evil`) in one match. A single-segment command still
 * gets the full glob/cwd-join/binary treatment through segmentMatchesAllowlist,
 * so simple commands behave exactly as before.
 */
export function commandMatchesExecAllowlist(command, patterns = [], opts = {}) {
  if (!patterns.length) return true; // open if unset
  const cmd = String(command || "").trim();
  if (!cmd) return true;
  const cwd = opts.cwd || process.cwd();

  const { segments, unsafe } = scanCommand(cmd);
  if (unsafe) return false; // fail closed on unreasonable constructs
  const parts = segments.map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((seg) => segmentMatchesAllowlist(seg, patterns, cwd));
}
