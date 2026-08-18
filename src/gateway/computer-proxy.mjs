/**
 * Single-port surface: proxy computer HTTP through the gateway.
 *
 * External clients hit:
 *   http://gateway:18790/computer/proxy/<path>
 *   http://gateway:18790/xclaw/computer/<path>
 * Internally still talks to computer on cfg.computer.port (default 4243).
 *
 * Process isolation is preserved; only the public port count drops to one.
 */
import http from "node:http";

const PREFIXES = ["/computer/proxy/", "/xclaw/computer/"];

/**
 * @param {string} pathname
 * @returns {{ matched: boolean, upstreamPath: string } }
 */
export function matchComputerProxyPath(pathname) {
  const p = String(pathname || "");
  for (const pref of PREFIXES) {
    if (p === pref.slice(0, -1) || p === pref.replace(/\/$/, "")) {
      return { matched: true, upstreamPath: "/health" };
    }
    if (p.startsWith(pref)) {
      const rest = p.slice(pref.length);
      return { matched: true, upstreamPath: "/" + rest.replace(/^\/+/, "") };
    }
  }
  if (p === "/computer/proxy" || p === "/xclaw/computer") {
    return { matched: true, upstreamPath: "/health" };
  }
  return { matched: false, upstreamPath: p };
}

/**
 * @param {object} cfg
 * @returns {boolean}
 */
export function isComputerProxyEnabled(cfg = {}) {
  if (cfg.gateway?.proxyComputer === false) return false;
  if (process.env.XCLAW_GATEWAY_PROXY_COMPUTER === "0") return false;
  if (process.env.XCLAW_GATEWAY_PROXY_COMPUTER === "false") return false;
  return true;
}

/**
 * Forward req → computer upstream. Does not end the request on mismatch.
 * @returns {Promise<boolean>} true if handled
 */
export function proxyComputerRequest(req, res, cfg, url) {
  if (!isComputerProxyEnabled(cfg)) return Promise.resolve(false);
  const pathname = url?.pathname || new URL(req.url || "/", "http://local").pathname;
  const m = matchComputerProxyPath(pathname);
  if (!m.matched) return Promise.resolve(false);

  const host = cfg.computer?.host || "127.0.0.1";
  const port = cfg.computer?.port || 4243;
  const search = url?.search || "";
  const upstreamPath = (m.upstreamPath || "/") + search;

  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const onBody = () => {
      const bodyBuf = Buffer.concat(chunks);
      const headers = { ...req.headers, host: `${host}:${port}` };
      delete headers["connection"];
      delete headers["keep-alive"];
      delete headers["proxy-connection"];
      delete headers["transfer-encoding"];
      if (bodyBuf.length) headers["content-length"] = String(bodyBuf.length);
      else delete headers["content-length"];

      const preq = http.request(
        {
          hostname: host === "0.0.0.0" ? "127.0.0.1" : host,
          port,
          path: upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`,
          method: req.method,
          headers,
          timeout: Number(cfg.gateway?.proxyComputerTimeoutMs) || 120_000,
        },
        (pres) => {
          const outHeaders = { ...pres.headers };
          delete outHeaders["transfer-encoding"];
          res.writeHead(pres.statusCode || 502, outHeaders);
          pres.pipe(res);
          pres.on("end", () => finish(true));
          pres.on("error", () => finish(true));
        }
      );
      preq.on("timeout", () => {
        preq.destroy();
        if (!res.headersSent) {
          res.writeHead(504, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "computer proxy timeout" }));
        }
        finish(true);
      });
      preq.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "computer unreachable",
              detail: err.message,
              upstream: `http://${host}:${port}${upstreamPath}`,
            })
          );
        }
        finish(true);
      });
      if (bodyBuf.length) preq.write(bodyBuf);
      preq.end();
    };

    if (req.readableEnded || req.complete) {
      onBody();
      return;
    }
    req.on("data", (c) => chunks.push(c));
    req.on("end", onBody);
    req.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "request error" }));
      }
      finish(true);
    });
  });
}

export const COMPUTER_PROXY_PREFIXES = PREFIXES;
