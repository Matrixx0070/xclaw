/**
 * Workspace sandbox — path allowlists, deny .. escapes, optional read-only roots.
 */
import path from "node:path";

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
  const keys = ["path", "file", "filepath", "filename", "cwd", "directory", "dir"];
  try {
    for (const k of keys) {
      if (next[k] != null && typeof next[k] === "string") {
        const resolved = resolveSandboxPath(policy, next[k]);
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
