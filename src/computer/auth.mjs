/**
 * Shared computer auth — Bearer token + optional HMAC over body.
 */
import crypto from "node:crypto";

export function computerAuthToken(cfg) {
  return (
    cfg?.computer?.authToken ||
    process.env.XCLAW_COMPUTER_TOKEN ||
    process.env.XCLAW_COMPUTER_AUTH ||
    null
  );
}

export function computerAuthHeaders(cfg, body = null) {
  const token = computerAuthToken(cfg);
  if (!token) return {};
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-XClaw-Computer-Token": token,
  };
  if (cfg?.computer?.authHmac && body != null) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const ts = String(Date.now());
    const sig = crypto.createHmac("sha256", token).update(`${ts}.${raw}`).digest("hex");
    headers["X-XClaw-Timestamp"] = ts;
    headers["X-XClaw-Signature"] = sig;
  }
  return headers;
}

/**
 * Verify incoming request headers (for proxy / mock / future server hook).
 */
export function verifyComputerAuth(cfg, headers = {}, body = null) {
  const token = computerAuthToken(cfg);
  if (!token) return { ok: true, mode: "open" };
  const hdr = headers.authorization || headers.Authorization || "";
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7).trim() : "";
  const x = headers["x-xclaw-computer-token"] || headers["X-XClaw-Computer-Token"];
  const got = bearer || x || "";
  if (got !== token) return { ok: false, error: "unauthorized", status: 401 };
  if (cfg?.computer?.authHmac) {
    const ts = headers["x-xclaw-timestamp"] || headers["X-XClaw-Timestamp"];
    const sig = headers["x-xclaw-signature"] || headers["X-XClaw-Signature"];
    if (!ts || !sig) return { ok: false, error: "missing_hmac", status: 401 };
    const age = Math.abs(Date.now() - Number(ts));
    if (age > 5 * 60 * 1000) return { ok: false, error: "stale_timestamp", status: 401 };
    const raw = typeof body === "string" ? body : JSON.stringify(body ?? "");
    const expect = crypto.createHmac("sha256", token).update(`${ts}.${raw}`).digest("hex");
    const a = Buffer.from(String(sig));
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, error: "bad_signature", status: 401 };
    }
  }
  return { ok: true, mode: "token" };
}
