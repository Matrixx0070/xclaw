/**
 * Doctor: POST /stop token gate.
 */
import { stopAuthToken } from "../gateway/stop-auth.mjs";

export function pushStopAuthChecks(push, cfg = {}) {
  const token = stopAuthToken(cfg);
  const profile = String(cfg.profile || process.env.XCLAW_PROFILE || "").toLowerCase();
  const requireAuth = cfg.gateway?.requireAuth === true || profile === "prod" || profile === "strict";
  const disabled = cfg.gateway?.stopAuth === false || process.env.XCLAW_STOP_AUTH === "0";

  if (disabled) {
    push("gateway.stopAuth", requireAuth ? "error" : "warn", "stop auth disabled", {
      disabled: true,
      hasToken: Boolean(token),
    });
    return { disabled: true, hasToken: Boolean(token) };
  }
  if (!token && requireAuth) {
    push("gateway.stopAuth", "error", "prod/strict requires XCLAW_GATEWAY_TOKEN or gateway.stopToken", {
      hasToken: false,
      requireAuth: true,
    });
    return { hasToken: false, requireAuth: true };
  }
  if (!token) {
    push("gateway.stopAuth", "warn", "no stop token (lab open)", { hasToken: false });
    return { hasToken: false };
  }
  push("gateway.stopAuth", "ok", "POST /stop token gate configured", { hasToken: true });
  return { hasToken: true };
}

export default { pushStopAuthChecks };
