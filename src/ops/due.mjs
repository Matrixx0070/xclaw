/**
 * Persisted "is this periodic job due?" primitive.
 *
 * A bare `setInterval(job, 24h)` only fires if ONE process instance survives
 * 24 uninterrupted hours. A gateway that restarts more often than its own
 * maintenance interval therefore performs maintenance NEVER — and the failure
 * is silent, because nothing logs a run that did not happen.
 *
 * Observed live (2026-08-28): 337 gateway boots in the log, the daily tmp
 * sweep fired 5 times, last on 2026-08-22; six days of release restarts left
 * 83,671 stale /tmp/xclaw-* entries and suspended ledger compaction and JSONL
 * rotation with it.
 *
 * The fix is to schedule against a durable last-run stamp instead of process
 * uptime: a job is due when it has never run, or when `intervalMs` has elapsed
 * since the recorded run — so a restart resumes the schedule rather than
 * resetting it. Generic on purpose: any periodic job can adopt it by name.
 */
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { durableAtomicWriteJson } from "../utils/durable-write.mjs";

export function dueStatePath(cfg = {}) {
  const base = cfg.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "ops-schedule.json");
}

/** @returns {Promise<Record<string, number>>} name → last run epoch ms */
export async function readDueState(cfg = {}) {
  try {
    const raw = JSON.parse(await fsp.readFile(dueStatePath(cfg), "utf8"));
    const out = {};
    for (const [k, v] of Object.entries(raw?.lastRun || {})) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch {
    // absent or corrupt → treat as "never ran" (fail toward doing the work)
    return {};
  }
}

/**
 * Due when never run, when the stamp is in the future (clock moved back), or
 * when at least intervalMs has elapsed.
 */
export async function isDue(cfg = {}, name, intervalMs, now = Date.now()) {
  const last = (await readDueState(cfg))[name];
  if (!Number.isFinite(last)) return true;
  if (last > now) return true;
  return now - last >= Math.max(0, Number(intervalMs) || 0);
}

/** Record a completed run. Best-effort: a failed stamp must not fail the job. */
export async function markRan(cfg = {}, name, now = Date.now()) {
  const state = await readDueState(cfg);
  state[name] = now;
  try {
    await durableAtomicWriteJson(dueStatePath(cfg), { lastRun: state }, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export default { dueStatePath, readDueState, isDue, markRan };
