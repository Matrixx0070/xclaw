/**
 * Active agent session registry — kill / soft-stop.
 * Fully inspectable and killable (core philosophy).
 */
import { stopComputer } from "../computer/manager.mjs";

/** @type {Map<string, { abort: AbortController, startedAt: string, label?: string }>} */
const active = new Map();

export function registerSession(sessionId, { label } = {}) {
  const id = String(sessionId || `sess_${Date.now()}`);
  const prev = active.get(id);
  if (prev && !prev.abort.signal.aborted) {
    try {
      prev.abort.abort(new Error("session_replaced"));
    } catch {
      /* ignore */
    }
  }
  const abort = new AbortController();
  active.set(id, { abort, startedAt: new Date().toISOString(), label: label || id });
  return { sessionId: id, signal: abort.signal };
}

export function getSessionSignal(sessionId) {
  return active.get(String(sessionId))?.abort?.signal || null;
}

export function listActiveSessions() {
  return [...active.entries()].map(([id, v]) => ({
    sessionId: id,
    label: v.label,
    startedAt: v.startedAt,
    aborted: v.abort.signal.aborted,
  }));
}

export function killSession(sessionId) {
  const id = String(sessionId || "");
  const entry = active.get(id);
  if (!entry) return { ok: false, error: "unknown_session", sessionId: id };
  try {
    entry.abort.abort(new Error("kill_session"));
  } catch {
    /* ignore */
  }
  return { ok: true, sessionId: id, aborted: true };
}

/**
 * Abort every active agent session, close WS + SSE, optionally stop computer.
 */
export async function killAll({ stopComputer: stopComp = true, closeWs = true, closeSse = true, cfg } = {}) {
  const ids = [...active.keys()];
  for (const id of ids) killSession(id);
  let ws = null;
  if (closeWs) {
    try {
      const { closeAllWebSockets } = await import("../gateway/ws-hub.mjs");
      ws = closeAllWebSockets("kill_all");
    } catch (e) {
      ws = { ok: false, error: String(e?.message || e) };
    }
  }
  let sse = null;
  if (closeSse !== false) {
    try {
      const { closeAllSSEFanout } = await import("../gateway/sse-fanout-registry.mjs");
      sse = closeAllSSEFanout("kill_all");
    } catch (e) {
      sse = { ok: false, error: String(e?.message || e) };
    }
  }
  let computer = null;
  if (stopComp && cfg) {
    try {
      computer = await stopComputer(cfg);
    } catch (e) {
      computer = { ok: false, error: String(e?.message || e) };
    }
  }
  let bashBg = { ok: true, killed: [], missed: [] };
  try {
    const { killBackgroundBash } = await import("../computer/modules/bash-tool.mjs");
    bashBg = killBackgroundBash();
  } catch (e) {
    bashBg = { ok: false, error: String(e?.message || e), killed: [], missed: [] };
  }
  return { ok: true, killedSessions: ids, computer, ws, sse, bashBg };
}

export function unregisterSession(sessionId) {
  active.delete(String(sessionId));
}

export default {
  registerSession,
  getSessionSignal,
  listActiveSessions,
  killSession,
  killAll,
  unregisterSession,
};
