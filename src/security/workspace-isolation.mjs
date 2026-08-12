/**
 * Multi-workspace isolation — ensure chat bindings cannot cross-read.
 */
import path from "node:path";
import { workspaceForChat } from "../channels/policy.mjs";
import { resolveSandboxPath, getSandboxPolicy } from "./sandbox.mjs";

/**
 * Resolve workspace for a channel peer; fall back to default.
 */
export function resolvePeerWorkspace(cfg, channel, peerId, fallback) {
  return (
    workspaceForChat(cfg, channel, peerId, fallback) ||
    fallback ||
    process.cwd()
  );
}

/**
 * Assert path under peer workspace cannot resolve into another peer's root.
 */
export function assertIsolatedPath(cfg, channel, peerId, userPath, otherPeerId) {
  const wsA = path.resolve(resolvePeerWorkspace(cfg, channel, peerId, process.cwd()));
  const wsB = path.resolve(resolvePeerWorkspace(cfg, channel, otherPeerId, process.cwd()));
  if (wsA === wsB) {
    return { ok: false, error: "peers share workspace — isolation not configured" };
  }
  const policy = getSandboxPolicy({ sandbox: { enabled: true } }, wsA);
  let resolved;
  try {
    resolved = resolveSandboxPath(policy, userPath);
  } catch (e) {
    return { ok: true, denied: true, error: e.message };
  }
  const rel = path.relative(wsB, resolved);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return { ok: false, error: "path resolves inside other peer workspace", resolved, wsB };
  }
  return { ok: true, resolved, wsA };
}

/**
 * Validate workspaceByChatId map has distinct roots.
 */
export function validateWorkspaceMap(cfg, channel = "telegram") {
  const map = cfg?.channels?.[channel]?.workspaceByChatId || {};
  const ids = Object.keys(map);
  const issues = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = path.resolve(map[ids[i]]);
      const b = path.resolve(map[ids[j]]);
      if (a === b) issues.push(`${ids[i]} and ${ids[j]} share ${a}`);
      else if (a.startsWith(b + path.sep) || b.startsWith(a + path.sep)) {
        issues.push(`${ids[i]} nested under ${ids[j]}`);
      }
    }
  }
  return { ok: issues.length === 0, issues, count: ids.length };
}
