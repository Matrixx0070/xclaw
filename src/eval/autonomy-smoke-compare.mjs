/**
 * Compare current last-smoke.json to previous baseline.
 */
import fs from "node:fs";
import path from "node:path";
import { smokeArtifactPath } from "./autonomy-smoke-artifact.mjs";

export function previousSmokePath(root) {
  return path.join(root, "reports", "autonomy", "prev-smoke.json");
}

export function loadSmoke(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

export function hardBlockRateJump(previous, current, opts = {}) {
  const prev = Number(previous?.quotaEscalate?.hardBlockRate);
  const cur = Number(current?.quotaEscalate?.hardBlockRate);
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) {
    return { regressed: false, skipped: true };
  }
  const maxDelta = Number(opts.maxHardBlockRateDelta ?? process.env.XCLAW_MAX_HARD_BLOCK_RATE_DELTA ?? 0.2);
  const delta = cur - prev;
  return { regressed: delta > maxDelta, delta, maxDelta, prev, cur };
}

export function compareAutonomySmoke(root, opts = {}) {
  const curPath = opts.currentPath || smokeArtifactPath(root);
  const prevPath = opts.previousPath || previousSmokePath(root);
  const current = loadSmoke(curPath);
  const previous = loadSmoke(prevPath);

  if (!current) {
    return { ok: false, reason: "missing_current", current: null, previous };
  }
  if (!previous) {
    return {
      ok: current.ok !== false,
      reason: current.ok === false ? "current_failed" : "no_previous",
      current,
      previous: null,
      first: current.ok !== false,
    };
  }
  if (previous.ok === true && current.ok !== true) {
    return { ok: false, reason: "regressed", current, previous };
  }
  if (current.ok === false) {
    return { ok: false, reason: "current_failed", current, previous };
  }
  const jump = hardBlockRateJump(previous, current, opts);
  if (jump.regressed) {
    return { ok: false, reason: "quota_regressed", current, previous, jump };
  }
  return { ok: true, reason: "stable", current, previous, jump };
}

export function rotateSmokeBaseline(root) {
  const cur = smokeArtifactPath(root);
  const prev = previousSmokePath(root);
  if (!fs.existsSync(cur)) return { rotated: false };
  fs.mkdirSync(path.dirname(prev), { recursive: true });
  fs.copyFileSync(cur, prev);
  return { rotated: true, previousPath: prev };
}

export default { compareAutonomySmoke, rotateSmokeBaseline, previousSmokePath, hardBlockRateJump };
