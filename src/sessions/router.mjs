/**
 * Session routing & bindings — XClaw store + OpenClaw session-key semantics.
 */
import { randomUUID } from "node:crypto";
import {
  buildSessionKey,
  parseSessionKey,
  normalizeSessionKey,
  bindingKey,
} from "./session-key.mjs";
import {
  resolveSessionsPath,
  loadSessionState,
  saveSessionState,
} from "./persist.mjs";

const sessions = new Map();
const bindings = new Map(); // normalized sessionKey -> sessionId
// Import-time has no cfg. Stay null so we do not write the operator's
// home file. Gateway boot threads cfg via configureSessionPersist({ cfg }).
let persistPath = null;
let persistEnabled = true;
let saveTimer = null;

function scheduleSave() {
  if (!persistEnabled || !persistPath) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      saveSessionState(persistPath, {
        sessions: [...sessions.values()],
        bindings: Object.fromEntries(bindings),
      });
    } catch (err) {
      console.error("[xclaw:sessions] save failed", err.message);
    }
  }, 200);
}

export function sessionsPersistPath() {
  return persistPath;
}

export function configureSessionPersist(opts = {}) {
  // opts.path wins when non-empty. Empty string falls through so a
  // missing override still lands in configDir. Empty opts (enabled /
  // load only) keep the current path — gate-wiring tests toggle
  // enabled without re-supplying path.
  if (typeof opts.path === "string" && opts.path) persistPath = opts.path;
  else if (opts.cfg || opts.paths) persistPath = resolveSessionsPath(opts.cfg || opts);
  if (opts.enabled != null) persistEnabled = Boolean(opts.enabled);
  if (opts.load !== false) {
    const state = loadSessionState(persistPath);
    for (const s of state.sessions || []) {
      if (s?.id) sessions.set(s.id, s);
    }
    for (const [k, v] of Object.entries(state.bindings || {})) {
      bindings.set(k, v);
    }
  }
}
// auto-load on import — no cfg, no file. In-memory Maps still work.
try {
  configureSessionPersist({});
} catch {}

export function createSession(meta = {}) {
  const id = meta.id || randomUUID();
  const channel = meta.channel || "webchat";
  const peerId = meta.peerId || null;
  const peerKind = meta.peerKind || "dm";
  const sessionKey =
    meta.sessionKey ||
    (peerId
      ? buildSessionKey({
          agentId: meta.agentId,
          channel,
          peerKind,
          peerId,
          threadId: meta.threadId,
        })
      : `webchat:dm:${id}`);

  const s = {
    id,
    sessionKey: normalizeSessionKey(sessionKey) || sessionKey,
    channel,
    peerId,
    peerKind,
    threadId: meta.threadId || null,
    agentId: meta.agentId || null,
    workingDir: meta.workingDir || process.cwd(),
    agentModel: meta.agentModel || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: meta.title || "session",
  };
  sessions.set(id, s);
  bindings.set(s.sessionKey, id);
  if (peerId) {
    bindings.set(bindingKey(channel, peerId, peerKind), id);
  }
  scheduleSave();
  return s;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export function getSessionByKey(sessionKey) {
  const id = bindings.get(normalizeSessionKey(sessionKey) || sessionKey);
  return id ? sessions.get(id) : null;
}

export function touchSession(id) {
  const s = sessions.get(id);
  if (s) {
    s.updatedAt = new Date().toISOString();
    scheduleSave();
  }
  return s;
}

export function resolveBinding(channel, peerId, peerKind = "dm") {
  const key = bindingKey(channel, peerId, peerKind);
  const sid = bindings.get(key);
  if (sid && sessions.has(sid)) return sessions.get(sid);
  return createSession({ channel, peerId, peerKind });
}

export function bindPeer(channel, peerId, sessionId, peerKind = "dm") {
  const key = bindingKey(channel, peerId, peerKind);
  bindings.set(key, sessionId);
  const s = sessions.get(sessionId);
  if (s) {
    s.channel = channel;
    s.peerId = peerId;
    s.peerKind = peerKind;
    s.sessionKey = key;
    bindings.set(key, sessionId);
    scheduleSave();
  }
  return s;
}

export function listSessions() {
  return [...sessions.values()].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || "")
  );
}

export function setSessionModel(sessionId, model) {
  const s = sessions.get(sessionId);
  if (s) {
    s.agentModel = model;
    scheduleSave();
  }
  return s;
}

export {
  buildSessionKey,
  parseSessionKey,
  normalizeSessionKey,
  bindingKey,
};
