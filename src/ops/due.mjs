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
import fs from "node:fs";
import fsp from "node:fs/promises";
import { durableAtomicWriteJson } from "../utils/durable-write.mjs";

export function dueStatePath(cfg = {}) {
  const base = cfg.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "ops-schedule.json");
}

function parseDueState(text) {
  const raw = JSON.parse(text);
  const out = {};
  for (const [k, v] of Object.entries(raw?.lastRun || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/** @returns {Promise<Record<string, number>>} name → last run epoch ms */
export async function readDueState(cfg = {}) {
  try {
    return parseDueState(await fsp.readFile(dueStatePath(cfg), "utf8"));
  } catch {
    // absent or corrupt → treat as "never ran" (fail toward doing the work)
    return {};
  }
}

/**
 * Sync twin of readDueState, for schedulers that must seed a timer while
 * registering a job. The cron scheduler's addJob is synchronous, and making
 * it async would ripple through every caller for no gain.
 */
export function readDueStateSync(cfg = {}) {
  try {
    return parseDueState(fs.readFileSync(dueStatePath(cfg), "utf8"));
  } catch {
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

/**
 * Record a completed run. Best-effort: a failed stamp must not fail the job.
 *
 * Serialized, because every job shares one stamp file: two jobs read-modify-
 * writing concurrently would drop one stamp, and a job whose stamp keeps
 * getting dropped re-runs at every boot — the hot-loop this design exists to
 * prevent. Interleaving became reachable the moment a second job adopted the
 * primitive.
 */
let writeChain = Promise.resolve();
export function markRan(cfg = {}, name, now = Date.now()) {
  const run = writeChain.then(async () => {
    const state = await readDueState(cfg);
    state[name] = now;
    await durableAtomicWriteJson(dueStatePath(cfg), { lastRun: state }, { mode: 0o600 });
    return true;
  });
  writeChain = run.then(
    () => {},
    () => {},
  );
  return run.catch(() => false);
}

/**
 * Health of a scheduled job, for reporting.
 *
 * Never-run is not a fault — the boot catch-up will pick it up. Past twice
 * its interval means the schedule is not actually running, which is exactly
 * the failure this module exists to make visible: the six-day outage was
 * silent because a job that does not run logs nothing.
 */
export async function dueJobStatus(cfg = {}, name, intervalMs, now = Date.now()) {
  const last = (await readDueState(cfg))[name];
  if (!Number.isFinite(last)) return { ran: false, overdue: false };
  const ageMs = Math.max(0, now - last);
  return { ran: true, ageMs, ageHours: ageMs / 3600_000, overdue: ageMs > 2 * intervalMs };
}

/**
 * Arm a periodic job: an overdue catch-up shortly after boot, then the
 * interval. The boot run is the half that makes a schedule survive restarts —
 * an interval alone re-arms from zero every boot and, on a host that redeploys
 * faster than the interval, fires never.
 *
 * Owns timers only; `tick` owns due-ness and stamping.
 */
export function startPeriodic({ intervalMs, bootDelayMs = 60_000, tick }) {
  const boot = setTimeout(tick, Math.max(0, Number(bootDelayMs) || 0));
  const interval = setInterval(tick, intervalMs);
  for (const t of [boot, interval]) if (t.unref) t.unref();
  return {
    intervalMs,
    timers: [boot, interval],
    stop() {
      clearTimeout(boot);
      clearInterval(interval);
    },
  };
}

export default {
  dueStatePath,
  readDueState,
  readDueStateSync,
  isDue,
  markRan,
  dueJobStatus,
  startPeriodic,
};
