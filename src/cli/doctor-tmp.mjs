/**
 * Severity and wording for the stale-/tmp doctor probe.
 *
 * The probe used to count entries older than the sweeper's own 24h max age and
 * warn above fifty of them. But the sweeper runs once a day, so a full interval
 * of entries ages past that bound between any two sweeps, by construction.
 * Measured live at 3.312.0: 5,723 entries sat in the 24-48h window and exactly
 * one entry was older than that — a mission-referenced worktree the sweeper
 * deliberately skips. The probe reported a fault while the sweeper was working
 * perfectly, and did so on every host that runs the suite.
 *
 * The cost is not the false positive itself but what it hides: during the
 * six-day outage recorded in src/ops/due.mjs this probe said the same thing it
 * says now. A signal that reads identically in the healthy and the broken state
 * carries no information. Grading therefore starts one full sweep cycle past
 * the max age, where a count is evidence of litter the sweep cannot explain —
 * a sweeper that is not running at all is ops.schedule's probe to report.
 *
 * The row also summed removed + kept + skippedReferenced and never read the
 * sweep's fourth field, `errors`. A sweep that cannot readdir the tmpdir
 * returns those three empty and the reason in that field, so the row printed
 * `0 xclaw tmp entries ... ` at status ok: an unreadable tmpdir graded as a
 * pristine host. That is the inverse of the quota rows fixed at 3.313.0 —
 * there a missing artifact was reported as a fault, here a fault was reported
 * as health — and it has the same root, a count taken over a denominator that
 * was never measured. A sweep that could not look is not one that found
 * nothing.
 *
 * Pure on purpose: the probe body lives inside runDoctor, which loads the real
 * config and cannot be pointed at a fixture.
 */
import { humanMs } from "./doctor-schedule.mjs";

export const DEFAULT_TMP_THRESHOLD = 50;

/**
 * The age past which an entry is evidence rather than expected litter.
 *
 * One sweep interval of grace while something is collecting; the bare
 * retention bound when nothing is, because then no entry is ever coming back
 * under it.
 */
export function tmpGradeAgeMs({ maxAgeMs, intervalMs, sweepEnabled = true }) {
  return sweepEnabled ? maxAgeMs + intervalMs : maxAgeMs;
}

/**
 * @param {object} o
 * @param {number} o.unswept entries that outlived max age PLUS one sweep interval
 * @param {number} [o.total] all xclaw-owned tmp entries, fresh ones included
 * @param {number} o.maxAgeMs the sweeper's own retention bound
 * @param {number} o.intervalMs how often the sweep actually runs
 * @param {boolean} [o.sweepEnabled] false when config switched the sweep off
 * @param {string[]} [o.errors] sweep failures — an unreadable tmpdir, or one
 *   rm per entry the sweep could not remove
 * @returns {{status:"ok"|"warn", message:string}}
 */
export function tmpSweepProbe({
  unswept,
  total = unswept,
  maxAgeMs,
  intervalMs,
  sweepEnabled = true,
  threshold = DEFAULT_TMP_THRESHOLD,
  errors = [],
}) {
  // First, because a failed sweep invalidates every count below: those come
  // back zero whether the directory was empty or unreadable, and reporting the
  // zero would print a measurement that was never taken.
  if (errors.length) {
    const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
    return {
      status: "warn",
      message: `xclaw tmp sweep could not complete: ${errors[0]}${more}`,
    };
  }

  const over = unswept > threshold;

  // Nothing is coming to collect these, so the manual command is the remedy
  // here and only here. Offering it while the daily sweep is running told the
  // operator to do by hand what was already automatic.
  if (!sweepEnabled) {
    return {
      status: over ? "warn" : "ok",
      message: over
        ? `${unswept} xclaw tmp entries older than ${humanMs(maxAgeMs)} and the sweep is disabled — run: xclaw sweep-tmp`
        : `${unswept} stale xclaw tmp entries (sweep disabled)`,
    };
  }

  const cycle = humanMs(maxAgeMs + intervalMs);
  return over
    ? {
        status: "warn",
        message: `${unswept} of ${total} xclaw tmp entries outlived a full sweep cycle (${cycle}) — the sweep is not keeping up; check ops.schedule`,
      }
    : {
        status: "ok",
        message: `${total} xclaw tmp entries, ${unswept} past a full sweep cycle (${cycle})`,
      };
}

export default { tmpSweepProbe, tmpGradeAgeMs, DEFAULT_TMP_THRESHOLD };
