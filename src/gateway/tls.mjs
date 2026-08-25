/**
 * Optional HTTPS for gateway (P4.1).
 * cfg.gateway.tls = { cert, key, ca? } paths or env XCLAW_TLS_CERT / XCLAW_TLS_KEY
 *
 * Also wraps the request listener with the /stop kill switch, which must see
 * the body before the router parses it.
 */
import fs from "node:fs";
import https from "node:https";
import http from "node:http";

export function loadTlsOptions(cfg = {}) {
  const certPath =
    cfg.gateway?.tls?.cert || process.env.XCLAW_TLS_CERT || "";
  const keyPath = cfg.gateway?.tls?.key || process.env.XCLAW_TLS_KEY || "";
  const caPath = cfg.gateway?.tls?.ca || process.env.XCLAW_TLS_CA || "";
  if (!certPath || !keyPath) return null;
  try {
    const opts = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };
    if (caPath) opts.ca = fs.readFileSync(caPath);
    return opts;
  } catch (e) {
    console.error(`[xclaw] TLS load failed: ${e.message}`);
    return null;
  }
}

/**
 * Only the kill switch runs ahead of the router.
 *
 * The computer proxy used to run here too — ahead of the listener, and
 * therefore ahead of the gateway's 401 gate, which is inside it. That made
 * /computer/proxy/* and /xclaw/computer/* unauthenticated on every gateway
 * with the (default-on) proxy enabled, and the plane behind them answers
 * POST /tool with any tool, bash included. It now runs inside the listener,
 * below the gate (src/gateway/index.mjs), which is the only place it is
 * dispatched from.
 *
 * /stop stays: handleStopAll runs authorizeStop itself (gateway token, an
 * optional dedicated stop token, optional HMAC), and index.mjs has no /stop
 * route to fall through to. It must also see the body unparsed.
 */
function wrapWithStopIntercept(requestListener, cfg) {
  return async (req, res) => {
    try {
      const { tryHandleGatewayStop } = await import("./stop-proxy.mjs");
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (await tryHandleGatewayStop(req, res, cfg, url)) return;
    } catch {
      /* kill switch optional — fall through to the router */
    }
    return requestListener(req, res);
  };
}

export function createHttpServer(requestListener, cfg = {}) {
  const listener = wrapWithStopIntercept(requestListener, cfg);
  const tls = loadTlsOptions(cfg);
  if (tls) {
    console.log("[xclaw] TLS enabled");
    return { server: https.createServer(tls, listener), tls: true };
  }
  return { server: http.createServer(listener), tls: false };
}
