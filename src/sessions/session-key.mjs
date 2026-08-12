/**
 * Adapted from OpenClaw (MIT) — src/sessions/session-key-utils.ts + routing/session-key patterns
 * https://github.com/openclaw/openclaw
 *
 * Session key build/parse for channel peer routing.
 * Format: [agent:<agentId>:]<channel>:<peerKind>:<peerId>[:thread:<threadId>]
 */
function lower(s) {
  return String(s || "").trim().toLowerCase();
}

function nonEmpty(s) {
  const t = String(s || "").trim();
  return t || undefined;
}

/** Channels with case-sensitive peer IDs (OpenClaw policy). */
const CASE_PRESERVING = new Map([
  ["signal:group", "segment"],
  ["matrix:channel", "tail"],
  ["matrix:group", "tail"],
]);

export function isCasePreservingPeer(channel, peerKind) {
  return CASE_PRESERVING.has(`${lower(channel)}:${lower(peerKind)}`);
}

/**
 * Build a canonical session key.
 */
export function buildSessionKey(params = {}) {
  const parts = [];
  if (params.agentId) {
    parts.push("agent", lower(params.agentId));
  }
  const channel = lower(params.channel || "webchat");
  const peerKind = lower(params.peerKind || "dm");
  parts.push(channel, peerKind);

  let peerId = String(params.peerId ?? "").trim();
  if (peerId && !isCasePreservingPeer(channel, peerKind)) {
    peerId = peerId.toLowerCase();
  }
  parts.push(peerId || "unknown");

  if (params.threadId) {
    parts.push("thread", String(params.threadId).trim());
  }
  return parts.join(":");
}

/**
 * Parse a session key into structured fields.
 */
export function parseSessionKey(sessionKey) {
  const raw = String(sessionKey || "").trim();
  if (!raw) return null;
  const parts = raw.split(":");
  let i = 0;
  let agentId;
  if (lower(parts[0]) === "agent" && parts.length >= 2) {
    agentId = parts[1];
    i = 2;
  }
  const channel = parts[i++] || "";
  const peerKind = parts[i++] || "";
  let peerId = parts[i++] || "";
  let threadId;
  // remainder may be opaque peer id with colons (matrix) or thread suffix
  if (i < parts.length) {
    if (lower(parts[i]) === "thread") {
      threadId = parts.slice(i + 1).join(":");
    } else {
      // tail peer id
      peerId = [peerId, ...parts.slice(i)].filter(Boolean).join(":");
      // check trailing :thread:
      const thr = peerId.toLowerCase().lastIndexOf(":thread:");
      if (thr >= 0) {
        threadId = peerId.slice(thr + ":thread:".length);
        peerId = peerId.slice(0, thr);
      }
    }
  }
  return {
    agentId: nonEmpty(agentId),
    channel: nonEmpty(channel),
    peerKind: nonEmpty(peerKind),
    peerId: nonEmpty(peerId),
    threadId: nonEmpty(threadId),
    raw,
  };
}

/**
 * Normalize for lookup maps (lowercase except case-preserving peers).
 */
export function normalizeSessionKey(sessionKey) {
  const p = parseSessionKey(sessionKey);
  if (!p) return "";
  return buildSessionKey(p);
}

export function bindingKey(channel, peerId, peerKind = "dm") {
  return buildSessionKey({ channel, peerId, peerKind });
}
