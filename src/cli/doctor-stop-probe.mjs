/**
 * Optional live probe of POST /stop semantics when gateway is up.
 * GET → 405; unauthenticated POST (when token set) → 401.
 */
import http from "node:http";

export function probeStopRoute(opts = {}) {
  const host = opts.host || "127.0.0.1";
  const port = Number(opts.port || 0);
  if (!port) return Promise.resolve({ skipped: true, reason: "no_port" });

  const path = opts.path || "/stop";
  const timeoutMs = Number(opts.timeoutMs || 1500);

  function request(method, headers = {}) {
    return new Promise((resolve) => {
      const req = http.request(
        { host, port, path, method, headers, timeout: timeoutMs },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode, ok: true });
        }
      );
      req.on("timeout", () => {
        req.destroy();
        resolve({ status: 0, ok: false, error: "timeout" });
      });
      req.on("error", (e) => resolve({ status: 0, ok: false, error: e.message }));
      if (method === "POST") req.end("{}");
      else req.end();
    });
  }

  return (async () => {
    const get = await request("GET");
    if (!get.ok && get.error) {
      return { skipped: true, reason: "unreachable", get };
    }
    const post = await request("POST", { "content-type": "application/json" });
    return {
      skipped: false,
      getStatus: get.status,
      postStatus: post.status,
      methodNotAllowed: get.status === 405,
      unauthorized: post.status === 401 || post.status === 200,
      ok: get.status === 405 && (post.status === 401 || post.status === 200),
    };
  })();
}

export async function pushStopProbeChecks(push, cfg = {}) {
  if (process.env.XCLAW_DOCTOR_STOP_PROBE === "0") {
    push("gateway.stopProbe", "ok", "stop live probe disabled", { skipped: true });
    return { skipped: true };
  }
  const port = cfg.gateway?.port;
  if (!port) {
    push("gateway.stopProbe", "warn", "no gateway.port for stop probe", { skipped: true });
    return { skipped: true };
  }
  const r = await probeStopRoute({
    host: cfg.gateway?.host || "127.0.0.1",
    port,
  });
  if (r.skipped) {
    push("gateway.stopProbe", "warn", `stop probe skipped (${r.reason || "n/a"})`, r);
    return r;
  }
  const status = r.ok ? "ok" : "error";
  push(
    "gateway.stopProbe",
    status,
    `GET /stop → ${r.getStatus} (want 405), POST /stop → ${r.postStatus} (want 401 or 200)`,
    r
  );
  return r;
}

export default { probeStopRoute, pushStopProbeChecks };
