/**
 * Gateway boot: schedule approval digest cron (quiet when empty).
 */
import { ensureApprovalDigestCronJob } from "../cron/approval-digest-job.mjs";

export function startApprovalDigestCron(cfg = {}, opts = {}) {
  if (cfg.security?.digestCron === false || opts.enabled === false) {
    return { skipped: true, reason: "disabled" };
  }
  try {
    const job = ensureApprovalDigestCronJob({
      cfg,
      enabled: true,
      everyMs: opts.everyMs ?? cfg.security?.digestEveryMs ?? cfg.security?.digestIntervalMs,
      onlyIfPending: opts.onlyIfPending,
    });
    return { skipped: false, id: job.id, job };
  } catch (err) {
    return { skipped: true, reason: "error", error: err.message };
  }
}

export default { startApprovalDigestCron };
