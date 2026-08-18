/**
 * Single-port kill-switch fire-drill (no live server required).
 * Covers HTTP auth methods, WS/SSE control signing, TLS path parity markers.
 */
import fs from "node:fs";
import path from "node:path";
import { authorizeStop, signStopBody } from "../gateway/stop-auth.mjs";
import { handleWsStopControl } from "../gateway/ws-stop-control.mjs";
import { handleSseStopControl } from "../gateway/sse-stop-control.mjs";
import { buildStopControlMessage } from "../gateway/stop-control-auth.mjs";
import { recordLastDrain, getLastDrain } from "../gateway/last-drain.mjs";
import { tryHandleGatewayStop } from "../gateway/stop-proxy.mjs";
import { isStopPath, handleStopAll } from "../gateway/stop-route.mjs";

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

export function fireDrillTlsParity(root) {
  const tls = path.join(root, "src/gateway/tls.mjs");
  if (!fs.existsSync(tls)) {
    return { name: "tls_parity", ok: false, reason: "missing_tls_mjs" };
  }
  const src = fs.readFileSync(tls, "utf8");
  return {
    name: "tls_parity",
    ok: src.includes("tryHandleGatewayStop") && src.includes("stop-proxy"),
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

/**
 * @param {{ root?: string }} opts
 */
export async function runStopFireDrill(opts = {}) {
  const root = opts.root || process.cwd();
  const steps = [
    fireDrillHttpToken(),
    fireDrillHttpHmac(),
    fireDrillHmacCanonical(),
    await fireDrillWsSigned(),
    await fireDrillSseSigned(),
    fireDrillTlsParity(root),
    fireDrillPaths(),
    await fireDrillNonPost405(),
    await fireDrillDryRun(),
    fireDrillDrainAuthMethod(),
  ];
  const failed = steps.filter((s) => !s.ok);
  return {
    ok: failed.length === 0,
    steps,
    failed: failed.map((s) => s.name),
    at: new Date().toISOString(),
  };
}

export default { runStopFireDrill };
