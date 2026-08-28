/**
 * Stop kill-switch readiness for /health and doctor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runningVersion } from "./build-version.mjs";
import { stopAuthToken } from "./stop-auth.mjs";
import { ledgerSnapshot, dailyHardUsd } from "../tokens/swarm-ledger.mjs";

function readStopSurfaceFreeze() {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    // The pinned freeze marker is a disk fact by definition; the version
    // FALLBACK is not — it stood for "the stop surface this build ships", so
    // it has to be the running build rather than whatever the checkout is on.
    return pkg?.xclaw?.stopSurfaceFreeze || runningVersion();
  } catch {
    // Unreadable package.json means the freeze marker is unknown, not absent —
    // keep reporting null rather than substituting a version for it.
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
      swarmLedger: null,
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

  let swarmLedger = null;
  try {
    const snap = ledgerSnapshot(cfg);
    const hard = dailyHardUsd(cfg);
    const reserved = Number(snap.reservedUsd) || 0;
    const spent = Number(snap.spentUsd) || 0;
    swarmLedger = {
      day: snap.day,
      spentUsd: spent,
      reservedUsd: reserved,
      hardUsd: hard,
      pressure: hard > 0 ? (spent + reserved) / hard : 0,
    };
  } catch {
    /* */
  }

  return {
    auth,
    hmac,
    ready,
    singlePort: true,
    surfaceVersion: readStopSurfaceFreeze(),
    swarmLedger,
  };
}

export default { stopAuthReadiness, readStopSurfaceFreeze };
