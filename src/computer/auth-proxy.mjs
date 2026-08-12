/**
 * Thin auth proxy in front of computer server (Phase Q).
 * Verifies XCLAW_COMPUTER_TOKEN / HMAC then forwards to upstream.
 */
import http from "node:http";
import { verifyComputerAuth, computerAuthToken } from "./auth.mjs";

/**
 * @param {object} opts
 * @param {object} opts.cfg
 * @param {string} opts.upstream — e.g. http://127.0.0.1:4243
 * @param {number} opts.listenPort
 */
export function startComputerAuthProxy(opts = {}) {
  const cfg = opts.cfg || {};
  const upstream = new URL(opts.upstream || `http://127.0.0.1:${cfg.computer?.port || 4243}`);
  const listenPort = opts.listenPort || Number(process.env.XCLAW_COMPUTER_PROXY_PORT) || 4244;
  const token = computerAuthToken(cfg);
  if (!token && !opts.allowOpen) {
    console.warn("[xclaw:auth-proxy] no token configured — refusing to start open proxy");
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const bodyBuf = Buffer.concat(chunks);
      const bodyStr = bodyBuf.length ? bodyBuf.toString("utf8") : null;
      let bodyJson = null;
      if (bodyStr) {
        try {
          bodyJson = JSON.parse(bodyStr);
        } catch {
          bodyJson = bodyStr;
        }
      }
      const v = verifyComputerAuth(cfg, req.headers, bodyJson);
      if (!v.ok) {
        res.writeHead(v.status || 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: v.error || "unauthorized" }));
        return;
      }
      const headers = { ...req.headers, host: upstream.host };
      delete headers["content-length"];
      const preq = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: req.url,
          method: req.method,
          headers,
        },
        (pres) => {
          res.writeHead(pres.statusCode, pres.headers);
          pres.pipe(res);
        }
      );
      preq.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
      if (bodyBuf.length) preq.write(bodyBuf);
      preq.end();
    });
  });

  server.listen(listenPort, "127.0.0.1", () => {
    console.log(
      `[xclaw:auth-proxy] listening :${listenPort} → ${upstream.origin} (auth ${token ? "on" : "off"})`
    );
  });
  return server;
}

/** CLI entry helper */
export async function mainProxy(cfg) {
  return startComputerAuthProxy({ cfg, upstream: process.env.XCLAW_COMPUTER_UPSTREAM });
}
