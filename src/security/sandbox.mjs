/**
 * Workspace sandbox — path allowlists, deny .. escapes, optional read-only roots.
 */
import path from "node:path";
import { STRICT_PATH_ARG_KEYS } from "./risk.mjs";

/**
 * @param {object} cfg
 * @param {string} workspace
 */
export function getSandboxPolicy(cfg, workspace) {
  const sb = cfg?.sandbox || cfg?.security?.sandbox || {};
  return {
    enabled: sb.enabled !== false,
    workspace: path.resolve(workspace || process.cwd()),
    readOnly: Boolean(sb.readOnly),
    allowPaths: (sb.allowPaths || []).map((p) => path.resolve(p)),
    denyPatterns: sb.denyPatterns || ["**/.git/objects/**"],
  };
}

/**
 * Resolve a user path under workspace; throw if escapes.
 */
export function resolveSandboxPath(policy, userPath) {
  const rel = String(userPath || ".");
  if (rel.includes("\0")) throw new Error("sandbox: invalid path");
  // block absolute paths outside workspace unless allowlisted
  const abs = path.isAbsolute(rel)
    ? path.resolve(rel)
    : path.resolve(policy.workspace, rel);
  const norm = path.normalize(abs);
  const ws = policy.workspace;
  const relToWs = path.relative(ws, norm);
  if (relToWs.startsWith("..") || path.isAbsolute(relToWs)) {
    // allowlisted absolute roots
    const allowed = (policy.allowPaths || []).some(
      (root) => norm === root || norm.startsWith(root + path.sep)
    );
    if (!allowed) {
      throw new Error(`sandbox: path escapes workspace: ${userPath}`);
    }
    // Explicit allowPath: do not apply workspace-relative ".." checks
    return norm;
  }
  if (relToWs.split(path.sep).includes("..")) {
    throw new Error(`sandbox: path escapes workspace: ${userPath}`);
  }
  return norm;
}

/**
 * Compile one deny pattern to a RegExp. Supports the glob subset the shipped
 * default uses: `**` crosses separators, `*` and `?` do not. A trailing `/**`
 * also covers the directory itself — denying `secrets/**` while leaving
 * `secrets` reachable would be a hole in the rule the operator wrote.
 */
function globToRegExp(pattern) {
  let p = String(pattern || "");
  let tail = "";
  if (p.endsWith("/**")) {
    p = p.slice(0, -3);
    tail = "(?:/.*)?";
  }
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      i++;
      if (p[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + re + tail + "$");
}

/**
 * Return the deny pattern that covers `absPath`, or null.
 *
 * Checked against both the absolute path and its workspace-relative form, so
 * `**\/.env` and `.git/objects/**` both mean what an operator expects. Callers
 * apply this AFTER resolution: allowPaths widens the boundary, denyPatterns
 * cuts holes in whatever boundary resulted, so an allowlisted root can never
 * carry a denied path through.
 */
export function matchesDenyPattern(policy, absPath) {
  // A single pattern written as a bare string is the obvious config slip; read
  // it as a one-entry list rather than iterating its characters (each of which
  // would compile to a pattern of its own) or dropping the rule on the floor.
  const raw = policy?.denyPatterns;
  const patterns = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const posix = (v) => String(v).split(path.sep).join("/");
  const candidates = [posix(absPath)];
  const rel = path.relative(policy.workspace, absPath);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) candidates.push(posix(rel));
  for (const pattern of patterns) {
    const re = globToRegExp(pattern);
    if (candidates.some((c) => re.test(c))) return pattern;
  }
  return null;
}

export function assertWritable(policy, absPath) {
  if (policy.readOnly) {
    throw new Error("sandbox: workspace is read-only");
  }
  return absPath;
}

/** Middleware-style check for tool args with path/file fields */
export function guardToolPaths(cfg, workspace, toolName, args = {}) {
  const policy = getSandboxPolicy(cfg, workspace);
  if (!policy.enabled) return { ok: true, args };
  const next = { ...args };
  // Single-sourced from risk.mjs (S6b): the old local 7-key list missed
  // file_path/filePath — the exact keys the file tools use — so writes
  // outside the sandbox never hit this guard.
  const keys = STRICT_PATH_ARG_KEYS;
  try {
    for (const k of keys) {
      if (next[k] != null && typeof next[k] === "string") {
        const resolved = resolveSandboxPath(policy, next[k]);
        // Deny beats allow, and applies to reads as well as writes: a deny
        // list exists to keep named files out of the agent's hands entirely.
        const denied = matchesDenyPattern(policy, resolved);
        if (denied) {
          throw new Error(`sandbox: path denied by pattern ${denied}: ${next[k]}`);
        }
        if (/write|edit|delete|rm|mv|bash|shell/i.test(toolName)) {
          assertWritable(policy, resolved);
        }
        next[k] = resolved;
      }
    }
    return { ok: true, args: next, policy };
  } catch (err) {
    return { ok: false, error: err.message, policy };
  }
}
