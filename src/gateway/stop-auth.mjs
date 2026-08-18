/**
 * POST /stop must not be unauthenticated on a public single-port gateway.
 */
import crypto from "node:crypto";

export function signStopBody(secret, body = "") {
  return crypto.createHmac("sha256", String(secret || "")).update(String(body || "")).digest("hex");
}

function hmacEqual(got, expected) {
  const a = Buffer.from(String(got || ""), "hex");
  const b = Buffer.from(String(expected || ""), "hex");
  if (a.length !== 32 || b.length !== 32) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyStopSignature(req, cfg = {}, bodyRaw = "") {
  const secret = cfg.gateway?.stopHmacSecret || process.env.XCLAW_STOP_HMAC_SECRET || "";
  const required = cfg.gateway?.stopHmac === true || process.env.XCLAW_STOP_HMAC === "1";
  if (!secret) {
    if (required) return { ok: false, code: "STOP_HMAC_REQUIRED", message: "stop HMAC secret not configured" };
    return { ok: true, skipped: true };
  }
  const h = req.headers || {};
  const sig = String(h["x-xclaw-stop-sig"] || h["X-XClaw-Stop-Sig"] || "");
  const expected = signStopBody(secret, bodyRaw);
  if (!hmacEqual(sig, expected)) {
    return { ok: false, code: "STOP_HMAC_INVALID", message: "invalid X-XClaw-Stop-Sig" };
  }
  return { ok: true };
}

function tokenEqual(got, expected) {
  const a = crypto.createHash("sha256").update(String(got || "")).digest();
  const b = crypto.createHash("sha256").update(String(expected || "")).digest();
  return crypto.timingSafeEqual(a, b);
}

export function stopAuthToken(cfg = {}) {
  return (
    cfg.gateway?.stopToken ||
    cfg.gateway?.token ||
    process.env.XCLAW_STOP_TOKEN ||
    process.env.XCLAW_GATEWAY_TOKEN ||
    ""
  );
}

export function extractStopToken(req = {}) {
  const h = req.headers || {};
  const auth = String(h.authorization || h.Authorization || "");
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  const x = h["x-xclaw-token"] || h["x-xclaw-stop-token"] || h["x-api-key"];
  if (x) return String(x);
  try {
    return new URL(req.url || "/", "http://local").searchParams.get("token") || "";
  } catch {
    return "";
  }
}

export function authorizeStop(req, cfg = {}) {
  if (cfg.gateway?.stopAuth === false || process.env.XCLAW_STOP_AUTH === "0") {
    return { ok: true, skipped: true, authMethod: "disabled" };
  }
  const expected = stopAuthToken(cfg);
  if (!expected) {
    if (cfg.gateway?.requireAuth || cfg.profile === "prod" || cfg.profile === "strict") {
      return { ok: false, code: "STOP_AUTH_REQUIRED", message: "stop token not configured", authMethod: "missing" };
    }
    return { ok: true, skipped: true, reason: "no_token_lab", authMethod: "lab" };
  }
  const got = extractStopToken(req);
  if (!tokenEqual(got, expected)) {
    return { ok: false, code: "STOP_UNAUTHORIZED", message: "invalid stop token", authMethod: "token" };
  }
  let raw = "";
  try {
    raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  } catch {
    raw = "";
  }
  const hmac = verifyStopSignature(req, cfg, raw);
  if (!hmac.ok) return { ...hmac, authMethod: "hmac" };
  if (!hmac.skipped) return { ok: true, authMethod: "hmac" };
  return { ok: true, authMethod: "token" };
}

export default { authorizeStop, extractStopToken, stopAuthToken, signStopBody, verifyStopSignature };
