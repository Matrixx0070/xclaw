/**
 * Doctor: kill-switch covers sessions + WS + SSE.
 */
import { listActiveSessions } from "../agent/session-control.mjs";
import { getLastDrain } from "../gateway/last-drain.mjs";
import { normalizeStopChannel, isKnownStopChannel } from "./doctor-channel.mjs";

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
  let bashBg = 0;
  try {
    const { listBackgroundBash } = await import("../computer/modules/bash-tool.mjs");
    bashBg = listBackgroundBash().length;
  } catch {
    bashBg = 0;
  }
  push(
    "security.killSwitch",
    ready ? "ok" : "warn",
    `session kill-switch ready (activeSessions=${n} ws=${wsOk} sse=${sseOk} bashBg=${bashBg}); POST /stop or xclaw stop-all`,
    { activeSessions: n, closeWs: wsOk, closeSse: sseOk, bashBg, lastDrain }
  );
  if (lastDrain) {
    const method = lastDrain.authMethod || lastDrain.drain?.authMethod || "unknown";
    const rawChannel = lastDrain.channel || lastDrain.drain?.channel || "http";
    const channel = normalizeStopChannel(rawChannel);
    const channelOk = isKnownStopChannel(channel);
    push(
      "security.killSwitch.lastDrain",
      channelOk ? "ok" : "warn",
      `last stop drain authMethod=${method} channel=${channel} sessions=${lastDrain.sessionsKilled} ws=${lastDrain.wsClosed} sse=${lastDrain.sseClosed}`,
      { ...lastDrain, authMethod: method, channel, channelKnown: channelOk }
    );
  }
  return { ready, wsOk, sseOk, n, lastDrain };
}

export default { pushKillSwitchChecks };
