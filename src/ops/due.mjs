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
 *
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null. No home
 * fallback. Do not honour `XCLAW_STATE_DIR`. A cfg without configDir is
 * never a real caller (`loadConfig()` stamps it unconditionally).
 * `markRan`/`markArmed` no-op without persisting (do not `mkdir(null)`).
 */
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { durableAtomicWriteJson } from "../utils/durable-write.mjs";

export function dueStatePath(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "ops-schedule.json") : null;
}

function parseMap(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

function parseDueState(text) {
  return parseMap(JSON.parse(text)?.lastRun);
}

/**
 * The two epochs a schedule can count from, read together because they share
 * one file: when a job last ran, and when its clock was first started.
 */
function parseAnchors(text) {
  const raw = JSON.parse(text);
  return { lastRun: parseMap(raw?.lastRun), armed: parseMap(raw?.armed) };
}

/** @returns {Promise<Record<string, number>>} name → last run epoch ms */
export async function readDueState(cfg = {}) {
  const fp = dueStatePath(cfg);
  if (!fp) return {};
  try {
    return parseDueState(await fsp.readFile(fp, "utf8"));
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
  const fp = dueStatePath(cfg);
  if (!fp) return {};
  try {
    return parseDueState(fs.readFileSync(fp, "utf8"));
  } catch {
    return {};
  }
}

/**
 * One stamp file, so every writer shares one chain: two writers read-modify-
 * writing concurrently would drop a stamp, and a job whose stamp keeps getting
 * dropped re-runs at every boot — the hot loop this design exists to prevent.
 */
let writeChain = Promise.resolve();

async function readAnchors(cfg = {}) {
  const fp = dueStatePath(cfg);
  if (!fp) return { lastRun: {}, armed: {} };
  try {
    return parseAnchors(await fsp.readFile(fp, "utf8"));
  } catch {
    return { lastRun: {}, armed: {} };
  }
}

/** Sync twin of readAnchors, for the scheduler's synchronous addJob. */
export function readAnchorsSync(cfg = {}) {
  const fp = dueStatePath(cfg);
  if (!fp) return { lastRun: {}, armed: {} };
  try {
    return parseAnchors(fs.readFileSync(fp, "utf8"));
  } catch {
    return { lastRun: {}, armed: {} };
  }
}

/**
 * Record that a job's clock has STARTED, so an interval longer than the host's
 * uptime can still elapse.
 *
 * Anchoring to the last run resumes a schedule but cannot begin one: with no
 * stamp the first run stays a full interval out, and a host that restarts more
 * often than the interval recomputes that same distant first run forever. Two
 * of the three live maintenance crons sat in exactly that state after 3.285.0
 * — the hourly doctor and the daily eval suite, against a 24-minute median
 * uptime — because neither had ever produced a run stamp to anchor to.
 *
 * Kept separate from `lastRun` rather than seeding it, because seeding would
 * make `doctor` report a run that never happened. First arm wins: re-arming at
 * each boot would reset the clock and restore the bug this exists to fix, so
 * the check and the write share one serialized turn.
 */
export function markArmed(cfg = {}, name, now = Date.now()) {
  const run = writeChain.then(async () => {
    const fp = dueStatePath(cfg);
    if (!fp) return false;
    const { lastRun, armed } = await readAnchors(cfg);
    if (Number.isFinite(armed[name])) return false; // already counting; leave it
    armed[name] = now;
    await durableAtomicWriteJson(fp, { lastRun, armed }, { mode: 0o600 });
    return true;
  });
  writeChain = run.then(
    () => {},
    () => {}
  );
  return run.catch(() => false);
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
export function markRan(cfg = {}, name, now = Date.now()) {
  const run = writeChain.then(async () => {
    const fp = dueStatePath(cfg);
    if (!fp) return false;
    const { lastRun, armed } = await readAnchors(cfg);
    lastRun[name] = now;
    // Rewrites the whole file, so it must carry `armed` forward: dropping it
    // would re-arm every job at the next boot and reset the clocks.
    await durableAtomicWriteJson(fp, { lastRun, armed }, { mode: 0o600 });
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
  readAnchorsSync,
  isDue,
  markRan,
  markArmed,
  dueJobStatus,
  startPeriodic,
};
