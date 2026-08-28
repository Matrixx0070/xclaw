/**
 * Single-port kill-switch fire-drill (no live server required).
 * Covers HTTP auth methods, WS/SSE control signing, TLS path parity markers.
 *
 * Ten of the eleven steps run entirely in process. The eleventh — `tls_parity`
 * — reads a source file, and it used to resolve that file against a caller-
 * supplied `root` that defaulted to `process.cwd()`. Every caller in this repo
 * then computed the same repo root module-relatively and handed it back in.
 * The one caller that could not — `xclaw doctor`, which runs from wherever the
 * operator happens to stand — fell back to the cwd, `existsSync` was false, and
 * the drill reported `failed: tls_parity` on a perfectly healthy install. In a
 * prod/strict/requireAuth profile the doctor prints that as an ERROR: a red
 * alarm on the kill-switch, raised by standing in the wrong directory.
 *
 * `root` is gone. The drill checks the file at a fixed offset from itself, so
 * it examines the same source in a repo, in an install, and under any cwd.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { authorizeStop, signStopBody } from "../gateway/stop-auth.mjs";
import { handleWsStopControl } from "../gateway/ws-stop-control.mjs";
import { handleSseStopControl } from "../gateway/sse-stop-control.mjs";
import { buildStopControlMessage } from "../gateway/stop-control-auth.mjs";
import { recordLastDrain, getLastDrain } from "../gateway/last-drain.mjs";
import { tryHandleGatewayStop } from "../gateway/stop-proxy.mjs";
import { isStopPath, handleStopAll } from "../gateway/stop-route.mjs";
import { postStopSigned, buildStopSignResult } from "../cli/stop-sign.mjs";

export function fireDrillHttpToken() {
  const cfg = { gateway: { token: "drill-token" } };
  const auth = authorizeStop(
    { headers: { "x-xclaw-token": "drill-token" }, body: {} },
    cfg
  );
  return {
    name: "http_token",
    ok: auth.ok === true && auth.authMethod === "token",
    authMethod: auth.authMethod,
  };
}

export function fireDrillHttpHmac() {
  const secret = "drill-hmac-secret";
  const cfg = {
    gateway: { token: "drill-token", stopHmacSecret: secret, stopHmac: true },
  };
  const body = JSON.stringify({ type: "stop", action: "stop-all" });
  const sig = signStopBody(secret, body);
  const auth = authorizeStop(
    {
      headers: {
        "x-xclaw-token": "drill-token",
        "x-xclaw-stop-sig": sig,
      },
      body: JSON.parse(body),
      rawBody: body,
    },
    cfg
  );
  return {
    name: "http_hmac",
    ok: auth.ok === true && (auth.authMethod === "hmac" || auth.authMethod === "token"),
    authMethod: auth.authMethod,
    sigLen: sig.length,
  };
}

/** HMAC must match across key-order / whitespace variants. */
export function fireDrillHmacCanonical() {
  const secret = "drill-hmac-secret";
  const cfg = {
    gateway: { token: "drill-token", stopHmacSecret: secret, stopHmac: true },
  };
  const pretty =
    '{\n  "action": "stop-all",\n  "type": "stop"\n}';
  const shuffled = { type: "stop", action: "stop-all" };
  const sig = signStopBody(secret, shuffled);
  const auth = authorizeStop(
    {
      headers: {
        "x-xclaw-token": "drill-token",
        "x-xclaw-stop-sig": sig,
      },
      body: JSON.parse(pretty),
      rawBody: pretty,
    },
    cfg
  );
  return {
    name: "http_hmac_canonical",
    ok: auth.ok === true && auth.authMethod === "hmac",
    authMethod: auth.authMethod,
  };
}

export async function fireDrillWsSigned() {
  const secret = "drill-hmac-secret";
  const cfg = {
    gateway: { token: "drill-token", stopHmacSecret: secret },
  };
  const msg = buildStopControlMessage(cfg, { type: "stop", action: "stop-all" });
  const out = [];
  const r = await handleWsStopControl(msg, cfg, (p) => out.push(p));
  const payload = out[0] || r?.payload || {};
  return {
    name: "ws_signed",
    handled: r?.handled === true,
    ok: r?.ok === true && payload.ok !== false,
    authMethod: payload.authMethod || payload.drain?.authMethod || null,
    channel: payload.channel || null,
    result: payload,
  };
}

export async function fireDrillSseSigned() {
  const secret = "drill-hmac-secret";
  const cfg = {
    gateway: { token: "drill-token", stopHmacSecret: secret },
  };
  const msg = buildStopControlMessage(cfg, { type: "stop", action: "stop-all" });
  const out = [];
  const r = await handleSseStopControl(msg, cfg, (p) => out.push(p));
  const payload = out[0] || r?.payload || {};
  return {
    name: "sse_signed",
    handled: r?.handled === true,
    ok:
      r?.ok === true &&
      payload.ok !== false &&
      payload.channel === "sse" &&
      Boolean(payload.authMethod),
    authMethod: payload.authMethod || payload.drain?.authMethod || null,
    channel: payload.channel || null,
    result: payload,
  };
}

/** Where the TLS listener lives, relative to THIS module — never to the cwd. */
export function defaultTlsPath() {
  return fileURLToPath(new URL("../gateway/tls.mjs", import.meta.url));
}

/**
 * The TLS listener must route /stop through the same proxy the plain HTTP
 * listener uses, or the kill-switch is reachable on one port and not the other.
 *
 * @param {string} [tlsPath] override, for tests that need the negative branch.
 */
export function fireDrillTlsParity(tlsPath = defaultTlsPath()) {
  let src;
  try {
    src = fs.readFileSync(tlsPath, "utf8");
  } catch {
    // Only reachable if the install itself is broken — `src/` ships in the
    // package, so this is no longer "you ran doctor from your home directory".
    return { name: "tls_parity", ok: false, reason: "missing_tls_mjs", path: tlsPath };
  }
  const ok = src.includes("tryHandleGatewayStop") && src.includes("stop-proxy");
  return {
    name: "tls_parity",
    ok,
    ...(ok ? {} : { reason: "markers_absent", path: tlsPath }),
  };
}

export function fireDrillPaths() {
  return {
    name: "paths",
    ok:
      isStopPath("/stop") &&
      isStopPath("/xclaw/stop") &&
      isStopPath("/sessions/stop-all") &&
      !isStopPath("/health"),
  };
}

export async function fireDrillNonPost405() {
  let status = 0;
  const res = {
    writeHead(c) {
      status = c;
    },
    end() {},
  };
  const handled = await tryHandleGatewayStop(
    { method: "GET", url: "/stop" },
    res,
    { gateway: { token: "s" } },
    new URL("http://local/stop")
  );
  return {
    name: "non_post_405",
    ok: handled === true && status === 405,
    status,
  };
}

export async function fireDrillDryRun() {
  const r = await handleStopAll(
    { headers: {}, body: { type: "stop", dryRun: true } },
    null,
    { cfg: {} }
  );
  return {
    name: "http_dry_run",
    ok:
      r?.ok === true &&
      r?.dryRun === true &&
      Array.isArray(r?.killedSessions) &&
      r.killedSessions.length === 0,
    dryRun: r?.dryRun,
    authMethod: r?.authMethod,
  };
}

export function fireDrillDrainAuthMethod() {
  recordLastDrain({
    sessionsKilled: 0,
    wsClosed: 0,
    sseClosed: 0,
    authMethod: "hmac",
  });
  const last = getLastDrain();
  return {
    name: "drain_auth_method",
    ok: last?.authMethod === "hmac",
    authMethod: last?.authMethod,
  };
}

export async function fireDrillPostOffline() {
  const signed = buildStopSignResult(
    { gateway: { token: "drill-token", host: "127.0.0.1", port: 9 } },
    { dryRun: true }
  );
  const live = await postStopSigned(signed, {
    timeoutMs: 200,
    fetchImpl: async () => {
      const e = new Error("fetch failed");
      e.cause = { code: "ECONNREFUSED" };
      throw e;
    },
  });
  return {
    name: "post_offline",
    ok: live.ok === false && live.code === "GATEWAY_OFFLINE",
    code: live.code,
    error: live.error,
  };
}

/**
 * @param {{ tlsPath?: string }} [opts] — `tlsPath` is a test seam. There is
 *   deliberately no `root`: see the header. The drill's verdict must not
 *   depend on the caller's working directory.
 */
export async function runStopFireDrill(opts = {}) {
  const steps = [
    fireDrillHttpToken(),
    fireDrillHttpHmac(),
    fireDrillHmacCanonical(),
    await fireDrillWsSigned(),
    await fireDrillSseSigned(),
    fireDrillTlsParity(opts.tlsPath),
    fireDrillPaths(),
    await fireDrillNonPost405(),
    await fireDrillDryRun(),
    await fireDrillPostOffline(),
    fireDrillDrainAuthMethod(),
  ];
  // Guard: the offline-POST probe is the one step that proves the CLI reports
  // a dead gateway instead of a false success. If it ever drops out of the
  // list the drill must fail loudly rather than pass with fewer steps.
  if (!steps.some((s) => s?.name === "post_offline")) {
    steps.push({ name: "post_offline", ok: false, error: "post_offline step missing" });
  }
  const failed = steps.filter((s) => !s.ok);
  return {
    ok: failed.length === 0,
    steps,
    failed: failed.map((s) => s.name),
    at: new Date().toISOString(),
  };
}

export default { runStopFireDrill };
