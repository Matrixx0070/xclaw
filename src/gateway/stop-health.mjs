/**
 * Stop kill-switch readiness for /health and doctor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stopAuthToken } from "./stop-auth.mjs";

function readStopSurfaceFreeze() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return pkg?.xclaw?.stopSurfaceFreeze || pkg?.version || null;
  } catch {
    return null;
  }
}

export function stopAuthReadiness(cfg = {}) {
  if (cfg.gateway?.stopAuth === false || process.env.XCLAW_STOP_AUTH === "0") {
    return {
      auth: "disabled",
      hmac: "disabled",
      ready: true,
      note: "stop auth disabled",
      surfaceVersion: readStopSurfaceFreeze(),
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
    surfaceVersion: readStopSurfaceFreeze(),
  };
}

export default { stopAuthReadiness, readStopSurfaceFreeze };
