/**
 * Doctor: POST /stop body HMAC gate.
 */
export function pushStopHmacChecks(push, cfg = {}) {
  const secret =
    cfg.gateway?.stopHmacSecret || process.env.XCLAW_STOP_HMAC_SECRET || "";
  const required =
    cfg.gateway?.stopHmac === true || process.env.XCLAW_STOP_HMAC === "1";
  const profile = String(cfg.profile || process.env.XCLAW_PROFILE || "").toLowerCase();
  const prodLike = profile === "prod" || profile === "strict" || cfg.gateway?.requireAuth === true;

  if (required && !secret) {
    push("gateway.stopHmac", "error", "stop HMAC required but XCLAW_STOP_HMAC_SECRET unset", {
      required: true,
      hasSecret: false,
    });
    return { hasSecret: false, required: true };
  }
  if (secret) {
    push("gateway.stopHmac", "ok", "POST /stop HMAC (X-XClaw-Stop-Sig) configured", {
      hasSecret: true,
      required,
    });
    return { hasSecret: true, required };
  }
  if (prodLike) {
    push(
      "gateway.stopHmac",
      "warn",
      "prod/strict has no stop HMAC secret (token-only /stop auth)",
      { hasSecret: false, prodLike: true }
    );
    return { hasSecret: false, prodLike: true };
  }
  push("gateway.stopHmac", "ok", "stop HMAC optional (lab)", { hasSecret: false });
  return { hasSecret: false };
}

export default { pushStopHmacChecks };
