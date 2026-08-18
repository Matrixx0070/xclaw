/**
 * Scheduled approval digest (critical vs soft channels).
 * Quiet by default when nothing is pending (security.digestOnlyIfPending).
 */
import { addJob, listJobs, cancelJob } from "./scheduler.mjs";
import { sendApprovalDigest } from "../security/approval-digest.mjs";

export const DEFAULT_DIGEST_EVERY_MS = 5 * 60 * 1000;

/**
 * @param {object} [opts]
 * @param {object} [opts.cfg]
 * @param {function} [opts.deliver]
 * @param {boolean} [opts.onlyIfPending] — default true (cfg.security.digestOnlyIfPending)
 */
export async function runApprovalDigestJob(opts = {}) {
  const cfg = { ...(opts.cfg || {}) };
  cfg.security = {
    digestOnlyIfPending: true,
    ...(cfg.security || {}),
  };
  if (opts.onlyIfPending === false) {
    cfg.security.digestOnlyIfPending = false;
  } else if (opts.onlyIfPending === true) {
    cfg.security.digestOnlyIfPending = true;
  }
  const result = await sendApprovalDigest(cfg, {
    deliver: opts.deliver,
  });
  const pending = result.digest?.pending ?? 0;
  if (!result.sent && result.reason === "empty") {
    console.log(`[xclaw:digest-cron] quiet (no pending approvals)`);
  } else {
    console.log(
      `[xclaw:digest-cron] sent=${Boolean(result.sent)} reason=${result.reason || "ok"} pending=${pending}`
    );
  }
  return result;
}

export function ensureApprovalDigestCronJob(opts = {}) {
  const name = opts.name || "xclaw-approval-digest";
  const everyMs = Number(opts.everyMs ?? cfgEvery(opts.cfg) ?? DEFAULT_DIGEST_EVERY_MS);
  for (const j of listJobs()) {
    if (j.name === name || j.payload?.kind === "approval_digest") {
      cancelJob(j.id);
    }
  }
  return addJob({
    name,
    schedule: { kind: "every", everyMs: Math.max(30_000, everyMs) },
    enabled: opts.enabled !== false,
    delivery: opts.delivery || null,
    sessionKey: opts.sessionKey || null,
    payload: { kind: "approval_digest", onlyIfPending: opts.onlyIfPending !== false },
    cfg: opts.cfg,
    handler: async () => runApprovalDigestJob(opts),
  });
}

function cfgEvery(cfg) {
  return cfg?.security?.digestEveryMs ?? cfg?.cron?.approvalDigestEveryMs;
}

export default { runApprovalDigestJob, ensureApprovalDigestCronJob, DEFAULT_DIGEST_EVERY_MS };
