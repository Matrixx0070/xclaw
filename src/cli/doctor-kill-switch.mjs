/**
 * Doctor: kill-switch covers sessions + WS + SSE.
 */
import { listActiveSessions } from "../agent/session-control.mjs";

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
  push(
    "security.killSwitch",
    ready ? "ok" : "warn",
    `session kill-switch ready (activeSessions=${n} ws=${wsOk} sse=${sseOk}); POST /stop or xclaw stop-all`,
    { activeSessions: n, closeWs: wsOk, closeSse: sseOk }
  );
  return { ready, wsOk, sseOk, n };
}

export default { pushKillSwitchChecks };
