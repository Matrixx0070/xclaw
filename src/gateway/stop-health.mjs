/**
 * Stop kill-switch readiness for /health and doctor.
 */
import { stopAuthToken } from "./stop-auth.mjs";

export function stopAuthReadiness(cfg = {}) {
  if (cfg.gateway?.stopAuth === false || process.env.XCLAW_STOP_AUTH === "0") {
    return {
      auth: "disabled",
      hmac: "disabled",
      ready: true,
      note: "stop auth disabled",
    };
  }
  const token = stopAuthToken(cfg);
  const secret =
    cfg.gateway?.stopHmacSecret || process.env.XCLAW_STOP_HMAC_SECRET || "";
  const hmacRequired =
    cfg.gateway?.stopHmac === true || process.env.XCLAW_STOP_HMAC === "1";
  const prod =
    cfg.profile === "prod" ||
    cfg.profile === "strict" ||
    cfg.gateway?.requireAuth === true;

  const auth = token ? "token" : prod ? "missing" : "lab";
  let hmac = "off";
  if (secret) hmac = "configured";
  else if (hmacRequired) hmac = "missing";

  const ready = auth !== "missing" && hmac !== "missing";

  return {
    auth,
    hmac,
    ready,
    singlePort: true,
  };
}

export default { stopAuthReadiness };
