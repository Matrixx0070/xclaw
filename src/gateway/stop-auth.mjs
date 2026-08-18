/**
 * POST /stop must not be unauthenticated on a public single-port gateway.
 */
import crypto from "node:crypto";

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
    return { ok: true, skipped: true };
  }
  const expected = stopAuthToken(cfg);
  if (!expected) {
    if (cfg.gateway?.requireAuth || cfg.profile === "prod" || cfg.profile === "strict") {
      return { ok: false, code: "STOP_AUTH_REQUIRED", message: "stop token not configured" };
    }
    return { ok: true, skipped: true, reason: "no_token_lab" };
  }
  const got = extractStopToken(req);
  if (!tokenEqual(got, expected)) {
    return { ok: false, code: "STOP_UNAUTHORIZED", message: "invalid stop token" };
  }
  return { ok: true };
}

export default { authorizeStop, extractStopToken, stopAuthToken };
