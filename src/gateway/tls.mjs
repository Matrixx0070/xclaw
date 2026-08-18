/**
 * Optional HTTPS for gateway (P4.1).
 * cfg.gateway.tls = { cert, key, ca? } paths or env XCLAW_TLS_CERT / XCLAW_TLS_KEY
 *
 * Also wraps the request listener so computer proxy runs first
 * (single external port) without editing the large index.mjs.
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

function wrapWithComputerProxy(requestListener, cfg) {
  return async (req, res) => {
    try {
      const { isComputerProxyEnabled, proxyComputerRequest } = await import(
        "./computer-proxy.mjs"
      );
      if (isComputerProxyEnabled(cfg)) {
        const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
        const proxied = await proxyComputerRequest(req, res, cfg, url);
        if (proxied) return;
      }
    } catch {
      /* proxy optional — fall through */
    }
    return requestListener(req, res);
  };
}

export function createHttpServer(requestListener, cfg = {}) {
  const listener = wrapWithComputerProxy(requestListener, cfg);
  const tls = loadTlsOptions(cfg);
  if (tls) {
    console.log("[xclaw] TLS enabled");
    return { server: https.createServer(tls, listener), tls: true };
  }
  return { server: http.createServer(listener), tls: false };
}
