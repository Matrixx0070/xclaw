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
  const dryRun = body.dryRun === true || body.dry_run === true;
  if (dryRun) {
    const drain = {
      sessionsKilled: 0,
      sessionsBefore: before.length,
      wsClosed: 0,
      sseClosed: 0,
      wsOk: true,
      sseOk: true,
      authMethod: auth.authMethod || (auth.skipped ? "lab" : "token"),
      dryRun: true,
    };
    const payload = {
      ok: true,
      dryRun: true,
      killedSessions: [],
      before: before.length,
      drain,
      authMethod: drain.authMethod,
      message: "dry-run: auth ok, no sessions aborted",
    };
    if (res && typeof res.writeHead === "function") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    }
    return payload;
  }
  const r = await killAll({
    cfg,
    stopComputer: body.keepComputer === true ? false : body.stopComputer !== false,
    closeWs: body.closeWs !== false,
    closeSse: body.closeSse !== false,
  });
  const drain = {
    ...drainStats(r, before),
    authMethod: auth.authMethod || (auth.skipped ? "lab" : "token"),
  };
  recordLastDrain(drain, { cfg });
  const payload = {
    ok: true,
    killedSessions: r.killedSessions || [],
    before: before.length,
    ws: r.ws || null,
    sse: r.sse || null,
    computer: r.computer || null,
    drain,
    authMethod: drain.authMethod,
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
