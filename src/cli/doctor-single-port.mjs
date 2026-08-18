/**
 * Doctor check: single public gateway port proxies computer (OpenClaw-style).
 */

import { isComputerProxyEnabled, matchComputerProxyPath } from "../gateway/computer-proxy.mjs";
import { isSinglePortStopPath } from "../gateway/stop-proxy.mjs";

/**
 * @param {object} cfg
 * @returns {{ id: string, status: string, message: string }[]}
 */
export function singlePortChecks(cfg = {}) {
  const checks = [];
  const gwPort = cfg.gateway?.port;
  const compPort = cfg.computer?.port ?? 4243;
  const enabled = isComputerProxyEnabled(cfg);

  if (!enabled) {
    checks.push({
      id: "gateway.singlePort",
      status: "warn",
      message:
        "computer proxy disabled (gateway.proxyComputer=false) — clients need a second port for computer",
    });
    return checks;
  }

  checks.push({
    id: "gateway.singlePort",
    status: "ok",
    message: `computer proxy enabled; public surface is gateway:${gwPort ?? "?"} (computer internal :${compPort})`,
  });

  const m = matchComputerProxyPath("/computer/proxy/health");
  if (!m.matched) {
    checks.push({
      id: "gateway.singlePort.paths",
      status: "error",
      message: "matchComputerProxyPath failed for /computer/proxy/health",
    });
  } else {
    checks.push({
      id: "gateway.singlePort.paths",
      status: "ok",
      message: "proxy prefixes /computer/proxy/ and /xclaw/computer/ match",
    });
  }

  const stopPaths = ["/stop", "/xclaw/stop", "/computer/proxy/stop", "/xclaw/computer/stop"];
  const stopOk = stopPaths.every((sp) => isSinglePortStopPath(sp));
  checks.push({
    id: "gateway.singlePort.stop",
    status: stopOk ? "ok" : "error",
    message: stopOk
      ? "single-port kill-switch paths: /stop /xclaw/stop /computer/proxy/stop"
      : "single-port /stop prefixes not recognized",
  });

  if (gwPort != null && compPort != null && Number(gwPort) === Number(compPort)) {
    checks.push({
      id: "gateway.singlePort.ports",
      status: "warn",
      message: `gateway.port and computer.port are both ${gwPort} — bind conflict risk unless computer is out-of-process elsewhere`,
    });
  }

  return checks;
}

export function pushSinglePortChecks(push, cfg = {}) {
  for (const c of singlePortChecks(cfg)) {
    push(c.id, c.status, c.message);
  }
}

export default { singlePortChecks, pushSinglePortChecks };
