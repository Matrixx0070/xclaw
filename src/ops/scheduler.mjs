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
import { isDue, markRan } from "./due.mjs";

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

/** Log one run's outcome through the caller's logger. */
export function reportOpsRun(result, log = console.log, warn = console.warn) {
  if (!result?.ran) return;
  if (result.tmp?.removed?.length) {
    log(`[xclaw:ops] tmp sweep: removed ${result.tmp.removed.length} stale entries`);
  }
  const m = result.maintenance;
  if (m && !m.skipped) {
    if (m.ledger?.removed?.length) {
      log(`[xclaw:ops] ledger compact: removed ${m.ledger.removed.length} segments`);
    }
    for (const rot of m.rotated || []) {
      log(`[xclaw:ops] rotated ${rot.path} (${rot.bytes} → ${rot.keptBytes} bytes)`);
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

  const bootDelayMs = Number(opts.bootDelayMs ?? DEFAULT_BOOT_DELAY_MS);
  const boot = setTimeout(tick, Math.max(0, bootDelayMs));
  const interval = setInterval(tick, intervalMs);
  for (const t of [boot, interval]) if (t.unref) t.unref();
  return {
    enabled: true,
    intervalMs,
    timers: [boot, interval],
    stop() {
      clearTimeout(boot);
      clearInterval(interval);
    },
  };
}

export default { runDueOps, startOpsSchedule, opsIntervalMs, opsScheduleEnabled, OPS_JOB };
