/**
 * Spec §11.6 + §11.10 — `xclaw doctor --fix`.
 *
 * Default doctor is read-only (including the scheduled cron doctor). This
 * module is the only doctor path that mutates operator JSON: each absorber
 * inserts first, then renames the source to `.bak` only if moved > 0.
 * Do not rewrite xclaw.json. Do not call this from openControlPlane.
 */
import {
  absorbLegacyCronJson,
  legacyCronJsonFile,
  openCronLedger,
} from "../cron/durable-jobs.mjs";
import {
  absorbPairingJson,
  openControlPlane,
  pairingJsonFile,
} from "../state/control-plane.mjs";

function note(result) {
  const moved = result?.moved || 0;
  return result?.error ? `moved=${moved} ${result.error}` : `moved=${moved}`;
}

export async function runDoctorFix(push, cfg) {
  try {
    const cron = openCronLedger(cfg);
    try {
      const n1 = absorbLegacyCronJson(cron, legacyCronJsonFile(cfg));
      push("fix.cron", n1.error ? "warn" : "ok", note(n1));
    } finally {
      cron.close();
    }
  } catch (err) {
    push("fix.cron", "warn", err.message || String(err));
  }

  try {
    const plane = openControlPlane(cfg);
    try {
      const n2 = absorbPairingJson(plane, pairingJsonFile(cfg));
      push("fix.pairing", n2.error ? "warn" : "ok", note(n2));
    } finally {
      try {
        plane.close();
      } catch {
        /* already closed */
      }
    }
  } catch (err) {
    push("fix.pairing", "warn", err.message || String(err));
  }
}
