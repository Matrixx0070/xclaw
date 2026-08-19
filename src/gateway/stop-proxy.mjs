/**
 * Single-port /stop: handle locally, including computer-proxy prefixes.
 * Used by both plain HTTP and TLS-wrapped listeners (same authorizeStop path).
 */
import { handleStopAll, isStopPath } from "./stop-route.mjs";
import { matchComputerProxyPath } from "./computer-proxy.mjs";

const MAX_STOP_BODY_BYTES = 64 * 1024;

async function readJsonBody(req) {
  try {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_STOP_BODY_BYTES) return {};
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

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
  // This intercept runs ahead of the main router (see wrapWithComputerProxy),
  // so nothing has parsed the body yet. handleStopAll only reads req.body —
  // without this, `dryRun: true` was never seen and a dry-run kill-switch
  // probe aborted every live session instead of reporting what it would do.
  if (!req.body || typeof req.body !== "object" || !Object.keys(req.body).length) {
    req.body = await readJsonBody(req);
  }
  await handleStopAll(req, res, { cfg });
  return true;
}

export default { isSinglePortStopPath, tryHandleGatewayStop };
