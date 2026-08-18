/**
 * Assert resume hash-verify + lab require-tip are wired.
 */
import fs from "node:fs";

export const CHECKPOINT_HASH_NEEDLES = [
  "verifyCheckpointToolHash",
  "shouldRequireToolHashTip",
];

export function checkpointHashNeedles(src) {
  const missing = CHECKPOINT_HASH_NEEDLES.filter((n) => !String(src || "").includes(n));
  return { ok: missing.length === 0, missing };
}

export function checkCheckpointHashNeedles(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  return checkpointHashNeedles(src);
}

export default { CHECKPOINT_HASH_NEEDLES, checkpointHashNeedles, checkCheckpointHashNeedles };
