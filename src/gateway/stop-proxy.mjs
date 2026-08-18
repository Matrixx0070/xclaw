/**
 * Single-port /stop: handle locally, including computer-proxy prefixes.
 * Used by both plain HTTP and TLS-wrapped listeners (same authorizeStop path).
 */
import { handleStopAll, isStopPath } from "./stop-route.mjs";
import { matchComputerProxyPath } from "./computer-proxy.mjs";

export function isSinglePortStopPath(pathname) {
  if (isStopPath(pathname)) return true;
  const m = matchComputerProxyPath(pathname);
  if (!m.matched) return false;
  const up = String(m.upstreamPath || "");
  return up === "/stop" || up === "/sessions/stop-all" || up.endsWith("/stop");
}

export async function tryHandleGatewayStop(req, res, cfg, url) {
  const pathname = url?.pathname || new URL(req.url || "/", "http://local").pathname;
  if (!isSinglePortStopPath(pathname)) return false;
  if (String(req.method || "POST").toUpperCase() !== "POST") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed", allow: "POST" }));
    return true;
  }
  await handleStopAll(req, res, { cfg });
  return true;
}

export default { isSinglePortStopPath, tryHandleGatewayStop };
