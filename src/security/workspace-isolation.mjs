/**
 * Multi-workspace isolation — ensure chat bindings cannot cross-read.
 */
import path from "node:path";
import { workspaceForChat, chatWorkspaceMap } from "../channels/policy.mjs";
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
 * Validate one channel's per-chat map has distinct roots.
 */
export function validateWorkspaceMap(cfg, channel = "telegram") {
  const map = chatWorkspaceMap(cfg, channel);
  const r = auditWorkspaceIsolation({ channels: { [channel]: { workspaceByChatId: map } } });
  return { ok: r.ok, issues: r.issues.map((i) => i.detail), count: r.count };
}

/**
 * Every chat->workspace binding this config carries, across all channels.
 *
 * Derived from the config rather than from a list of channel names: the
 * binding is read as cfg.channels[<any>], so a hard-coded list would go stale
 * the moment a further channel gains the feature and would report a clean
 * host while that channel's chats shared a root.
 */
function workspaceBindings(cfg) {
  const out = [];
  for (const channel of Object.keys(cfg?.channels || {})) {
    for (const [id, dir] of Object.entries(chatWorkspaceMap(cfg, channel))) {
      if (typeof dir === "string" && dir) {
        out.push({ channel, id, label: `${channel}:${id}`, root: path.resolve(dir) });
      }
    }
  }
  return out;
}

/**
 * Report chat workspaces that overlap.
 *
 * The sandbox roots itself at the per-chat workspace and enforces "stay inside
 * your workspace" correctly, which is exactly why it cannot catch this: when
 * two chats name the SAME root, or one nests inside the other, every path is
 * inside both workspaces and every check passes. The operator has configured
 * isolation and has none. Pairs are compared across channels as well as within
 * one, because the property is about distinct peers and peers span channels.
 */
export function auditWorkspaceIsolation(cfg) {
  const bindings = workspaceBindings(cfg);
  const issues = [];
  for (let i = 0; i < bindings.length; i++) {
    for (let j = i + 1; j < bindings.length; j++) {
      const a = bindings[i];
      const b = bindings[j];
      if (a.root === b.root) {
        issues.push({ kind: "shared", a, b, detail: `${a.label} and ${b.label} share ${a.root}` });
      } else if (b.root.startsWith(a.root + path.sep)) {
        issues.push({ kind: "nested", a, b, detail: `${b.label} (${b.root}) is nested under ${a.label} (${a.root})` });
      } else if (a.root.startsWith(b.root + path.sep)) {
        issues.push({ kind: "nested", a: b, b: a, detail: `${a.label} (${a.root}) is nested under ${b.label} (${b.root})` });
      }
    }
  }
  return { ok: issues.length === 0, issues, count: bindings.length };
}
