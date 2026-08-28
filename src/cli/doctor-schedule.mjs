/**
 * Wording for the "is this scheduled job actually running?" doctor probes.
 *
 * Pure on purpose. The probes live inside `runDoctor`, which loads the real
 * config and cannot be pointed at a fixture, so the branch that matters most —
 * what "never run yet" actually means — shipped untested. The decision is the
 * part worth pinning; the config plumbing around it is not.
 */

/** Sub-hour intervals rendered as "0h", so a five-minute digest read as zero. */
export function humanMs(ms) {
  return ms >= 3600_000
    ? `${(ms / 3600_000).toFixed(1).replace(/\.0$/, "")}h`
    : `${Math.max(0, Math.round(ms / 60_000))}m`;
}

/**
 * @param {object} o
 * @param {{ran:boolean, ageMs?:number, overdue?:boolean}} o.status from dueJobStatus
 * @param {number} [o.armed] arm-epoch stamp, when the job is anchored and armed
 * @param {boolean} [o.anchored] counts its first interval from a durable stamp
 * @returns {{status:"ok"|"warn", message:string}}
 */
export function scheduleProbe({
  status,
  label,
  intervalMs,
  armed,
  anchored = false,
  now = Date.now(),
}) {
  if (status.ran) {
    return status.overdue
      ? {
          status: "warn",
          message: `${label} last ran ${humanMs(status.ageMs)} ago (interval ${humanMs(intervalMs)}) — is the gateway up?`,
        }
      : { status: "ok", message: `${label} ran ${humanMs(status.ageMs)} ago` };
  }

  // "Never run" means two different things for an anchored job, and only one of
  // them is a countdown: an arm stamp says the clock is running and survives
  // restarts, no stamp says it has not started. An unanchored job is the third
  // case — it catches up shortly after boot and has no interval to wait out.
  // Collapsing the three is how a job that never armed read as merely young.
  if (anchored && Number.isFinite(armed)) {
    return {
      status: "ok",
      message: `never run yet — armed ${humanMs(now - armed)} ago, first run in ${humanMs(Math.max(0, armed + intervalMs - now))}`,
    };
  }
  return {
    status: "ok",
    message: anchored
      ? "never run yet (arms at next gateway boot, then waits one interval)"
      : "never run yet (runs shortly after next gateway boot)",
  };
}

export default { humanMs, scheduleProbe };
