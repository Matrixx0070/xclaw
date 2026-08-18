/**
 * Doctor: kill-switch covers sessions + WS + SSE.
 */
import { listActiveSessions } from "../agent/session-control.mjs";
import { getLastDrain } from "../gateway/last-drain.mjs";

export async function pushKillSwitchChecks(push) {
  const n = listActiveSessions().length;
  let wsOk = false;
  let sseOk = false;
  try {
    const ws = await import("../gateway/ws-hub.mjs");
    wsOk = typeof ws.closeAllWebSockets === "function";
  } catch {
    /* */
  }
  try {
    const sse = await import("../gateway/sse-fanout-registry.mjs");
    sseOk = typeof sse.closeAllSSEFanout === "function";
  } catch {
    /* */
  }
  const ready = wsOk && sseOk;
  const lastDrain = getLastDrain();
  push(
    "security.killSwitch",
    ready ? "ok" : "warn",
    `session kill-switch ready (activeSessions=${n} ws=${wsOk} sse=${sseOk}); POST /stop or xclaw stop-all`,
    { activeSessions: n, closeWs: wsOk, closeSse: sseOk, lastDrain }
  );
  if (lastDrain) {
    push(
      "security.killSwitch.lastDrain",
      "ok",
      `last stop drain sessions=${lastDrain.sessionsKilled} ws=${lastDrain.wsClosed} sse=${lastDrain.sseClosed}`,
      lastDrain
    );
  }
  return { ready, wsOk, sseOk, n, lastDrain };
}

export default { pushKillSwitchChecks };
