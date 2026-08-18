/**
 * Run land-batchN.mjs --check; fail if any NEED wires remain.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const LAND_BATCH_SCRIPTS = [
  "scripts/land-batch3.mjs",
  "scripts/land-batch4.mjs",
  "scripts/land-batch5.mjs",
];

export function runLandBatchChecks(root, opts = {}) {
  const results = [];
  let ok = true;
  for (const rel of LAND_BATCH_SCRIPTS) {
    const fp = path.join(root, rel);
    if (!fs.existsSync(fp)) {
      results.push({ script: rel, skipped: true, code: 0 });
      continue;
    }
    const r = spawnSync(process.execPath, [fp, "--check"], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
    const code = r.status ?? 1;
    if (code !== 0) ok = false;
    results.push({
      script: rel,
      code,
      out: ((r.stdout || "") + (r.stderr || "")).trim().split("\n").slice(-12),
    });
  }
  if (!ok && opts.fail !== false) {
    return { ok: false, results };
  }
  return { ok, results };
}

export default { runLandBatchChecks, LAND_BATCH_SCRIPTS };
