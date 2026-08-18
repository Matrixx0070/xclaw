/**
 * CLI helper: mint X-XClaw-Stop-Sig for POST /stop.
 *
 *   xclaw stop --sign [--body '{}'] [--print-curl]
 *   xclaw stop-sign
 */
import { signStopBody, stopAuthToken } from "../gateway/stop-auth.mjs";

export function resolveStopSecret(cfg = {}) {
  return (
    cfg.gateway?.stopHmacSecret ||
    process.env.XCLAW_STOP_HMAC_SECRET ||
    ""
  );
}

/**
 * @param {object} cfg
 * @param {{ body?: string|object, printCurl?: boolean, baseUrl?: string }} opts
 */
export function buildStopSignResult(cfg = {}, opts = {}) {
  const bodyObj =
    opts.body == null
      ? { type: "stop", action: "stop-all" }
      : typeof opts.body === "string"
        ? (() => {
            try {
              return JSON.parse(opts.body);
            } catch {
              return opts.body;
            }
          })()
        : opts.body;
  const raw =
    typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj);
  const secret = resolveStopSecret(cfg);
  const token = stopAuthToken(cfg);
  const sig = secret ? signStopBody(secret, raw) : null;
  const base =
    opts.baseUrl ||
    `http://${cfg.gateway?.host || "127.0.0.1"}:${cfg.gateway?.port || 18790}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (token) headers["X-XClaw-Token"] = token;
  if (sig) headers["X-XClaw-Stop-Sig"] = sig;
  const result = {
    ok: Boolean(secret || token),
    body: raw,
    bodyObject: typeof bodyObj === "object" ? bodyObj : undefined,
    sig,
    token: token || null,
    headers,
    hasSecret: Boolean(secret),
    hasToken: Boolean(token),
  };
  if (opts.printCurl) {
    const hdr = Object.entries(headers)
      .map(([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`)
      .join(" ");
    result.curl = `curl -sS -X POST ${JSON.stringify(`${base}/stop`)} ${hdr} -H 'Content-Type: application/json' -d ${JSON.stringify(raw)}`;
  }
  return result;
}

/**
 * @param {string[]} args — argv after command name
 */
export async function stopSignMain(args = [], loadConfigFn) {
  const printCurl = args.includes("--print-curl") || args.includes("--curl");
  const jsonOnly = args.includes("--json");
  let body = null;
  const bi = args.indexOf("--body");
  if (bi >= 0 && args[bi + 1]) body = args[bi + 1];
  const load =
    loadConfigFn ||
    (async () => {
      const { loadConfig } = await import("../config/load.mjs");
      return loadConfig();
    });
  const cfg = await load();
  const r = buildStopSignResult(cfg, { body: body || undefined, printCurl });
  if (!r.hasSecret && !r.hasToken) {
    console.error(
      "[xclaw] stop --sign: no stop HMAC secret and no gateway token configured"
    );
    process.exitCode = 1;
  } else if (!r.hasSecret) {
    console.error(
      "[xclaw] stop --sign: no HMAC secret (token-only headers emitted)"
    );
  }
  if (jsonOnly || !printCurl) {
    console.log(JSON.stringify(r, null, 2));
  } else if (r.curl) {
    console.log(r.curl);
  }
  return r;
}

export default { buildStopSignResult, stopSignMain, resolveStopSecret };
