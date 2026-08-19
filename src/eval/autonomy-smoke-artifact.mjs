/**
 * Write reports/autonomy/last-smoke.json after offline autonomy smoke.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  loadJobIndexQuota,
  normalizeQuotaEscalate,
  emptyQuotaEscalate,
} from "./autonomy-smoke-quota.mjs";

const require = createRequire(import.meta.url);

export function smokeArtifactPath(root) {
  return path.join(root, "reports", "autonomy", "last-smoke.json");
}

function tryGetLastDrain() {
  try {
    return require("../gateway/last-drain.mjs").getLastDrain?.() || null;
  } catch {
    return null;
  }
}

export function writeAutonomySmokeArtifact(root, result = {}) {
  const dir = path.join(root, "reports", "autonomy");
  fs.mkdirSync(dir, { recursive: true });
  const quotaEscalate = normalizeQuotaEscalate(
    result.quotaEscalate || loadJobIndexQuota(root, result.jobsDir) || emptyQuotaEscalate()
  );
  const lastDrain =
    result.lastDrain || result.stop?.lastDrain || tryGetLastDrain() || null;
  const payload = {
    at: new Date().toISOString(),
    ok: result.ok !== false && Number(result.status ?? 0) === 0,
    status: result.status ?? 0,
    tests: result.tests || [],
    mode: result.mode || "offline",
    env: { smoke: process.env.XCLAW_AUTONOMY_SMOKE || null },
    quotaEscalate,
    lastDrain,
  };
  const fp = smokeArtifactPath(root);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, fp);
  return { path: fp, payload };
}

export default { writeAutonomySmokeArtifact, smokeArtifactPath };
