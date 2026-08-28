/**
 * Stale tmp sweeper — worktree/test litter under os.tmpdir().
 *
 * Suite runs and mission/subagent worktrees create /tmp/xclaw-* entries;
 * tests that crash or get killed never clean theirs (observed live: 681
 * stale dirs). The sweeper removes ONLY entries that are all of:
 *   - directly under os.tmpdir() with an xclaw-owned prefix,
 *   - older than maxAgeMs (default 24h, mtime),
 *   - not referenced by any stored mission worktree (resumable missions
 *     keep their shadow workspace across restarts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Everything xclaw creates under os.tmpdir() carries this prefix (worktrees,
// merge patches, and dozens of test-fixture prefixes — a live host showed 20k
// entries across 40+ prefix families, so an enumerated list would just rot).
// Safety comes from the age gate + mission-worktree exclusion, not the name.
export const SWEEP_PREFIX = "xclaw-";

/** Retention bound. Exported so readers grade against the writer's own number. */
export const SWEEP_MAX_AGE_MS = 24 * 3600 * 1000;

export function isSweepCandidate(name) {
  return String(name).startsWith(SWEEP_PREFIX);
}

/** Worktree paths referenced by stored missions (any status — cheap + safe). */
export async function referencedMissionPaths(cfg = {}) {
  const out = new Set();
  const dir = path.join(cfg.paths?.configDir || path.join(os.homedir(), ".xclaw"), "missions");
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    try {
      const m = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      if (m?.worktree?.path) out.add(path.resolve(m.worktree.path));
    } catch {
      /* unreadable record — skip */
    }
  }
  return out;
}

/**
 * @param {object} [cfg]
 * @param {{ maxAgeMs?: number, dryRun?: boolean, tmpdir?: string }} [opts]
 * @returns {Promise<{removed: string[], kept: number, skippedReferenced: string[], errors: string[]}>}
 */
export async function sweepStaleTmp(cfg = {}, opts = {}) {
  const tmp = opts.tmpdir || os.tmpdir();
  const maxAgeMs = Math.max(60_000, Number(opts.maxAgeMs ?? SWEEP_MAX_AGE_MS));
  const dryRun = opts.dryRun === true;
  const referenced = await referencedMissionPaths(cfg);
  const removed = [];
  const skippedReferenced = [];
  const errors = [];
  let kept = 0;
  let names = [];
  try {
    names = await fs.readdir(tmp);
  } catch (e) {
    return { removed, kept, skippedReferenced, errors: [e.message] };
  }
  const now = Date.now();
  for (const name of names) {
    if (!isSweepCandidate(name)) continue;
    const full = path.join(tmp, name);
    if (referenced.has(path.resolve(full))) {
      skippedReferenced.push(name);
      continue;
    }
    let st;
    try {
      st = await fs.lstat(full);
    } catch {
      continue;
    }
    if (now - st.mtimeMs < maxAgeMs) {
      kept += 1;
      continue;
    }
    if (dryRun) {
      removed.push(name);
      continue;
    }
    try {
      await fs.rm(full, { recursive: true, force: true });
      removed.push(name);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { removed, kept, skippedReferenced, errors, dryRun };
}

