/**
 * POST /stop — session kill-switch (abort loops, drain SSE + WS).
 */
import { killAll, listActiveSessions } from "../agent/session-control.mjs";

export async function handleStopAll(req, res, { cfg } = {}) {
  let body = {};
  try {
    if (req.body && typeof req.body === "object") body = req.body;
  } catch {
    /* */
  }
  const before = listActiveSessions();
  const r = await killAll({
    cfg,
    stopComputer: body.keepComputer === true ? false : body.stopComputer !== false,
    closeWs: body.closeWs !== false,
    closeSse: body.closeSse !== false,
  });
  const payload = {
    ok: true,
    killedSessions: r.killedSessions || [],
    before: before.length,
    ws: r.ws || null,
    sse: r.sse || null,
    computer: r.computer || null,
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

export default { handleStopAll, isStopPath };
