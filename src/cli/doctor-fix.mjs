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
  openControlPlaneExclusive,
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
    const plane = openControlPlaneExclusive(cfg);
    if (!plane) {
      push("fix.pairing", "info", "no control plane path");
    } else {
      try {
        const n2 = absorbPairingJson(plane, pairingJsonFile(cfg));
        push("fix.pairing", n2.error ? "warn" : "ok", note(n2));
        // Spec §12.2 — drop retired names; a non-empty retired table is kept.
        const { dropRetiredIfEmpty } = await import("../state/schema-retirements.mjs");
        const r = dropRetiredIfEmpty(plane.db, "control");
        push(
          "fix.retirements",
          r.kept.length ? "warn" : "ok",
          `dropped=${r.dropped.length ? r.dropped.join(",") : "none"}` +
            (r.kept.length ? ` kept=${r.kept.join(",")}` : ""),
        );
      } finally {
        try {
          plane.close();
        } catch {
          /* already closed */
        }
      }
    }
  } catch (err) {
    push("fix.pairing", "warn", err.message || String(err));
  }
}
