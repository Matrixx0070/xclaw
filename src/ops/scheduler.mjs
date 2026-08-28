/**
 * Restart-safe scheduling for the daily ops job (stale-tmp sweep + ledger
 * compaction + JSONL rotation).
 *
 * Previously the gateway armed a bare `setInterval(…, 24h)` inline. The timer
 * restarts from zero on every boot, so on a host that redeploys more often
 * than once a day the job never ran at all — see src/ops/due.mjs for the live
 * evidence. Scheduling now goes through a persisted last-run stamp: on boot we
 * run once if the job is overdue (after a settle delay so readiness is not
 * slowed), then keep the interval as the steady-state path.
 */
import { isDue, markRan, startPeriodic } from "./due.mjs";

export const OPS_JOB = "ops.maintenance";
const DEFAULT_INTERVAL_MS = 24 * 3600 * 1000;
const MIN_INTERVAL_MS = 3_600_000;
const DEFAULT_BOOT_DELAY_MS = 60_000;

/** Resolved interval, floored at 1h (same clamp the inline timer used). */
export function opsIntervalMs(cfg = {}) {
  return Math.max(
    MIN_INTERVAL_MS,
    Number(cfg.ops?.maintenance?.intervalMs) ||
      Number(cfg.ops?.tmpSweep?.intervalMs) ||
      DEFAULT_INTERVAL_MS
  );
}

/** The timer is armed when EITHER half of the job is enabled. */
export function opsScheduleEnabled(cfg = {}) {
  return cfg.ops?.tmpSweep?.enabled !== false || cfg.ops?.maintenance?.enabled !== false;
}

/**
 * Run the daily ops job if it is due (or forced), then stamp it.
 * Never throws: each half is independently best-effort.
 *
 * @returns {Promise<{ran: boolean, skipped?: string, tmp?: object, maintenance?: object, errors: string[]}>}
 */
export async function runDueOps(cfg = {}, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const errors = [];
  if (!opts.force) {
    if (!opsScheduleEnabled(cfg)) return { ran: false, skipped: "disabled", errors };
    if (!(await isDue(cfg, OPS_JOB, opts.intervalMs ?? opsIntervalMs(cfg), now))) {
      return { ran: false, skipped: "not-due", errors };
    }
  }

  let tmp;
  if (cfg.ops?.tmpSweep?.enabled !== false) {
    try {
      const m = await import("./tmp-sweeper.mjs");
      tmp = await m.sweepStaleTmp(cfg);
    } catch (e) {
      errors.push(`tmp: ${e?.message || e}`);
    }
  }

  let maintenance;
  try {
    const m = await import("./maintenance.mjs");
    maintenance = await m.runOpsMaintenance(cfg);
  } catch (e) {
    errors.push(`maintenance: ${e?.message || e}`);
  }

  // Stamp even on partial failure: a job that fails every run must not
  // re-run on a tight loop at every boot.
  await markRan(cfg, OPS_JOB, now);
  return { ran: true, tmp, maintenance, errors };
}

/**
 * Log one run's outcome through the caller's logger.
 *
 * This is the ONLY path from the daily pass's result to a human — nothing
 * else in the codebase reads that object. It used to print the ledger and the
 * rotations and drop everything else, so the proof-bundle (3.316.0),
 * checkpoint (3.317.0) and memory-store (3.318.0) censuses were computed once
 * a day and seen by no one. The memory sweep in particular promises that a
 * directory it cannot attribute is counted `unattributable` and left alone;
 * that promise is worth nothing unheard. The tmp sweeper's `errors` had the
 * same problem one field over: dropped here, dropped by the doctor row, read
 * only by a manual CLI nobody runs.
 */
export function reportOpsRun(result, log = console.log, warn = console.warn) {
  if (!result?.ran) return;
  const tmp = result.tmp;
  if (tmp) {
    // Unconditional, for the same reason the maintenance censuses are: the old
    // line printed only when something was removed, so a sweep whose every rm
    // failed printed nothing at all — byte-identical to a clean host. Absence
    // of this line now means the sweep was never armed, never that it failed.
    log(
      `[xclaw:ops] tmp sweep: removed ${tmp.removed?.length || 0}, kept ${tmp.kept || 0} fresh, ` +
        `skipped ${tmp.skippedReferenced?.length || 0} referenced`
    );
    // sweepStaleTmp's fourth field had no reader anywhere on this path.
    for (const e of tmp.errors || []) warn("[xclaw:ops] tmp sweep:", e);
  }
  const m = result.maintenance;
  if (m && !m.skipped) {
    if (m.ledger?.removed?.length) {
      log(`[xclaw:ops] ledger compact: removed ${m.ledger.removed.length} segments`);
    }
    for (const rot of m.rotated || []) {
      log(`[xclaw:ops] rotated ${rot.path} (${rot.bytes} → ${rot.keptBytes} bytes)`);
    }
    // Measurements, not actions. Silence is reserved for what does not exist,
    // so that a line here always means something was actually measured.
    for (const s of m.sizes || []) {
      if (s.rotated || s.reason === "absent") continue;
      log(`[xclaw:ops] ${s.path}: ${s.bytes} bytes (under cap)`);
    }
    for (const d of m.dirs || []) {
      if (d.reason === "absent") continue;
      log(`[xclaw:ops] ${d.dir}: ${d.files} files / ${d.bytes} bytes, pruned ${d.pruned}`);
    }
    const cp = m.checkpoints;
    if (cp && cp.reason !== "no_dir") {
      log(`[xclaw:ops] checkpoints: kept ${cp.kept}, removed ${cp.removed} (protected ${cp.protected || 0})`);
    }
    const mem = m.memory;
    if (mem && mem.reason !== "absent") {
      log(
        `[xclaw:ops] memory workspaces: ${mem.workspaces} (${mem.keepers} live, ` +
          `${mem.orphans} orphaned, ${mem.unattributable} unattributable), pruned ${mem.pruned}`
      );
    }
    for (const e of m.errors || []) warn(`[xclaw:ops] maintenance ${e.target}:`, e.error);
  }
  for (const e of result.errors || []) warn(`[xclaw:ops] ${e}`);
}

/**
 * Arm the schedule: overdue catch-up shortly after boot, then the interval.
 * Returns handles so callers (and tests) can stop it.
 */
export function startOpsSchedule(cfg = {}, opts = {}) {
  if (!opsScheduleEnabled(cfg)) return { enabled: false, timers: [] };
  const intervalMs = opts.intervalMs ?? opsIntervalMs(cfg);
  const log = opts.log || console.log;
  const warn = opts.warn || console.warn;
  const tick = () =>
    runDueOps(cfg, { intervalMs })
      .then((r) => reportOpsRun(r, log, warn))
      .catch((e) => warn("[xclaw:ops] scheduled run failed:", e?.message || e));

  return {
    enabled: true,
    ...startPeriodic({
      intervalMs,
      bootDelayMs: opts.bootDelayMs ?? DEFAULT_BOOT_DELAY_MS,
      tick,
    }),
  };
}

export default { runDueOps, startOpsSchedule, opsIntervalMs, opsScheduleEnabled, OPS_JOB };
