/**
 * POST /stop — session kill-switch (abort loops, drain SSE + WS).
 */
import { killAll, listActiveSessions } from "../agent/session-control.mjs";
import { authorizeStop } from "./stop-auth.mjs";
import { recordLastDrain } from "./last-drain.mjs";

export function drainStats(r = {}, before = []) {
  const wsClosed = Number(r.ws?.closed ?? r.ws?.clients ?? 0) || 0;
  const sseClosed = Number(r.sse?.subscribers ?? r.sse?.closed ?? 0) || 0;
  return {
    sessionsKilled: Array.isArray(r.killedSessions) ? r.killedSessions.length : 0,
    sessionsBefore: Array.isArray(before) ? before.length : Number(before) || 0,
    wsClosed,
    sseClosed,
    wsOk: r.ws?.ok !== false,
    sseOk: r.sse == null || r.sse.ok !== false,
  };
}

export async function handleStopAll(req, res, { cfg } = {}) {
  let body = {};
  try {
    if (req.body && typeof req.body === "object") body = req.body;
  } catch {
    /* */
  }
  const auth = authorizeStop(req, cfg);
  if (!auth.ok) {
    const payload = { ok: false, error: auth.code, message: auth.message };
    if (res && typeof res.writeHead === "function") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    }
    return payload;
  }
  const before = listActiveSessions();
  const r = await killAll({
    cfg,
    stopComputer: body.keepComputer === true ? false : body.stopComputer !== false,
    closeWs: body.closeWs !== false,
    closeSse: body.closeSse !== false,
  });
  const drain = drainStats(r, before);
  recordLastDrain(drain);
  const payload = {
    ok: true,
    killedSessions: r.killedSessions || [],
    before: before.length,
    ws: r.ws || null,
    sse: r.sse || null,
    computer: r.computer || null,
    drain,
  };
  if (res && typeof res.writeHead === "function") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  }
  return payload;
}

export function isStopPath(pathname) {
  return (
    pathname === "/stop" ||
    pathname === "/xclaw/stop" ||
    pathname === "/sessions/stop-all"
  );
}

export default { handleStopAll, isStopPath, drainStats };
