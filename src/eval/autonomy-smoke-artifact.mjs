/**
 * Write reports/autonomy/last-smoke.json after offline autonomy smoke.
 */
import fs from "node:fs";
import path from "node:path";

export function smokeArtifactPath(root) {
  return path.join(root, "reports", "autonomy", "last-smoke.json");
}

export function writeAutonomySmokeArtifact(root, result = {}) {
  const dir = path.join(root, "reports", "autonomy");
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    at: new Date().toISOString(),
    ok: result.ok !== false && Number(result.status ?? 0) === 0,
    status: result.status ?? 0,
    tests: result.tests || [],
    mode: result.mode || "offline",
    env: { smoke: process.env.XCLAW_AUTONOMY_SMOKE || null },
  };
  const fp = smokeArtifactPath(root);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, fp);
  return { path: fp, payload };
}

export default { writeAutonomySmokeArtifact, smokeArtifactPath };
