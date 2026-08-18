/**
 * CLI helper: mint X-XClaw-Stop-Sig for POST /stop.
 *
 *   xclaw stop --sign [--body '{}'] [--print-curl] [--dry-run] [--post]
 *   xclaw stop-sign
 */
import { signStopBody, stopAuthToken, canonicalizeStopBody } from "../gateway/stop-auth.mjs";

export function resolveStopSecret(cfg = {}) {
  return (
    cfg.gateway?.stopHmacSecret ||
    process.env.XCLAW_STOP_HMAC_SECRET ||
    ""
  );
}

/**
 * @param {object} cfg
 * @param {{ body?: string|object, printCurl?: boolean, baseUrl?: string, dryRun?: boolean }} opts
 */
export function buildStopSignResult(cfg = {}, opts = {}) {
  let bodyObj =
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
  if (opts.dryRun && bodyObj && typeof bodyObj === "object") {
    bodyObj = { ...bodyObj, dryRun: true };
  }
  const raw = canonicalizeStopBody(bodyObj);
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
    baseUrl: base,
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
 * Live POST /stop using minted headers (optional network).
 * @param {ReturnType<typeof buildStopSignResult>} signed
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 */
export async function postStopSigned(signed, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, error: "fetch_unavailable" };
  }
  const base = signed.baseUrl || "http://127.0.0.1:18790";
  const url = `${base.replace(/\/$/, "")}/stop`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signed.headers || {}),
      },
      body: signed.body,
      signal: ctrl.signal,
    });
    let json = null;
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return {
      ok: res.ok && json?.ok !== false,
      status: res.status,
      response: json,
      dryRun: json?.dryRun === true,
      authMethod: json?.authMethod || json?.drain?.authMethod || null,
      killedSessions: json?.killedSessions || [],
    };
  } catch (e) {
    const msg = e.name === "AbortError" ? "timeout" : e.message || String(e);
    const offline =
      /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|fetch failed|network/i.test(msg) ||
      msg === "timeout";
    return {
      ok: false,
      error: offline ? (msg === "timeout" ? "timeout" : "gateway_offline") : msg,
      code: offline ? (msg === "timeout" ? "STOP_POST_TIMEOUT" : "GATEWAY_OFFLINE") : "STOP_POST_FAILED",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string[]} args — argv after command name
 */
export async function stopSignMain(args = [], loadConfigFn) {
  const printCurl = args.includes("--print-curl") || args.includes("--curl");
  const jsonOnly = args.includes("--json");
  const dryRun = args.includes("--dry-run") || args.includes("--dryrun");
  const doPost = args.includes("--post") || args.includes("--live");
  let body = null;
  const bi = args.indexOf("--body");
  if (bi >= 0 && args[bi + 1]) body = args[bi + 1];
  let baseUrl;
  const ui = args.indexOf("--url");
  if (ui >= 0 && args[ui + 1]) baseUrl = args[ui + 1];
  const load =
    loadConfigFn ||
    (async () => {
      const { loadConfig } = await import("../config/load.mjs");
      return loadConfig();
    });
  const cfg = await load();
  const r = buildStopSignResult(cfg, {
    body: body || undefined,
    printCurl,
    dryRun,
    baseUrl,
  });
  if (dryRun && r.ok) {
    r.dryRun = true;
    try {
      const { authorizeStop } = await import("../gateway/stop-auth.mjs");
      const auth = authorizeStop(
        { headers: r.headers, body: r.bodyObject || {} },
        cfg
      );
      r.auth = auth;
      r.authMethod = auth.authMethod;
      if (!auth.ok) {
        r.ok = false;
        process.exitCode = 1;
      }
    } catch (e) {
      r.authError = e.message || String(e);
    }
  }
  if (doPost && r.ok) {
    const live = await postStopSigned(r, { timeoutMs: 8000 });
    r.post = live;
    if (!live.ok) {
      r.ok = false;
      process.exitCode = live.code === "GATEWAY_OFFLINE" || live.code === "STOP_POST_TIMEOUT" ? 2 : 1;
      if (live.code === "GATEWAY_OFFLINE") {
        console.error("[xclaw] stop --post: gateway offline (ECONNREFUSED / unreachable)");
      } else if (live.code === "STOP_POST_TIMEOUT") {
        console.error("[xclaw] stop --post: gateway timeout");
      }
    } else if (dryRun && live.dryRun !== true) {
      r.ok = false;
      process.exitCode = 1;
      r.postError = "expected dryRun:true in gateway response";
    }
  }
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

export default {
  buildStopSignResult,
  stopSignMain,
  resolveStopSecret,
  postStopSigned,
};
