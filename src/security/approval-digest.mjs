/**
 * Approval digests — summarize aged pending approvals for operators.
 */
import { getSharedApprovalGate } from "./approvals.mjs";
import { deliverToChannel } from "../cron/channel-deliver.mjs";
import { buildRoutedApprovalDigest } from "./approval-digest-route.mjs";
import { isDue, markRan, startPeriodic } from "../ops/due.mjs";

export const DIGEST_JOB = "security.approvalDigest";

export function buildApprovalDigest(cfg) {
  const gate = getSharedApprovalGate(cfg);
  const pending = gate.listPending?.() || [];
  const slaMs = cfg?.security?.approvalSlaMs ?? 300_000;
  const aged = pending.filter((p) => (p.ageMs || 0) >= Math.min(60_000, slaMs / 2));
  const lines = [
    `XClaw approval digest — ${pending.length} pending (${aged.length} aged)`,
  ];
  for (const p of pending.slice(0, 15)) {
    const age = p.ageMs != null ? `${Math.round(p.ageMs / 1000)}s` : "?";
    const left = p.remainingMs != null ? `${Math.round(p.remainingMs / 1000)}s left` : "";
    const fp = p.planFingerprint ? ` plan=${p.planFingerprint.slice(0, 12)}` : "";
    const cmd = p.plan?.command || p.args?.command || p.args?.cmd || "";
    const cmdShort = cmd ? ` «${String(cmd).slice(0, 60)}»` : "";
    lines.push(`- ${p.id} ${p.tool} age=${age} ${left}${fp}${cmdShort}`.trim());
  }
  if (!pending.length) lines.push("(none)");
  return {
    text: lines.join("\n"),
    pending: pending.length,
    aged: aged.length,
    items: pending,
  };
}

export async function sendApprovalDigest(cfg, { deliver = deliverToChannel } = {}) {
  const digest = buildApprovalDigest(cfg);
  if (!digest.pending && cfg?.security?.digestOnlyIfPending !== false) {
    return { sent: false, reason: "empty", digest };
  }
  const routed = buildRoutedApprovalDigest(digest, cfg);
  const deliveries = [];
  async function sendBucket(bucket, kind) {
    if (!bucket.items.length && cfg?.security?.digestOnlyIfPending !== false) return;
    if (!bucket.targets.length) {
      deliveries.push({ kind, sent: false, reason: "no_targets" });
      return;
    }
    for (const t of bucket.targets) {
      try {
        await deliver(cfg, t, bucket.text);
        deliveries.push({ kind, sent: true, channel: t.channel || t });
      } catch (err) {
        console.error("[xclaw:digest]", err.message);
        deliveries.push({ kind, sent: false, error: err.message });
      }
    }
  }
  await sendBucket(routed.critical, "critical");
  await sendBucket(routed.soft, "soft");
  const sent = deliveries.some((d) => d.sent);
  return { sent, digest, routed, deliveries };
}

/**
 * Send the digest if its interval has elapsed since the last recorded send.
 * `send` is injectable in the same spirit as `deliver` above, so the schedule
 * can be exercised without standing up the shared approval gate.
 */
export async function runDueDigest(cfg = {}, opts = {}) {
  const intervalMs = Number(cfg?.security?.digestIntervalMs) || 0;
  if (intervalMs <= 0) return { ran: false, skipped: "disabled" };
  const now = Number(opts.now) || Date.now();
  if (!opts.force && !(await isDue(cfg, DIGEST_JOB, intervalMs, now))) {
    return { ran: false, skipped: "not-due" };
  }
  const send = opts.send || sendApprovalDigest;
  let result;
  let error;
  try {
    result = await send(cfg, opts);
  } catch (err) {
    error = err?.message || String(err);
  }
  // Stamp on failure too: a digest that always throws must not retry at every
  // boot, and the operator asked for a cadence, not a spin.
  await markRan(cfg, DIGEST_JOB, now);
  return { ran: true, result, error };
}

/**
 * Arm the digest on a persisted stamp rather than process uptime.
 *
 * The inline `setInterval(sendApprovalDigest, digestIntervalMs)` this replaces
 * had the same fail-open shape as the daily ops job (see src/ops/due.mjs): the
 * natural setting for this feature is a daily digest, and on a host that
 * redeploys daily that timer would never once have fired — silently, since a
 * digest that is not sent logs nothing.
 */
export function startApprovalDigestSchedule(cfg = {}, opts = {}) {
  const intervalMs = Number(cfg?.security?.digestIntervalMs) || 0;
  if (intervalMs <= 0) return { enabled: false, timers: [] };
  const warn = opts.warn || console.warn;
  const tick = () =>
    runDueDigest(cfg)
      .then((r) => {
        if (r.error) warn("[xclaw:digest]", r.error);
      })
      .catch((e) => warn("[xclaw:digest]", e?.message || e));
  return {
    enabled: true,
    ...startPeriodic({ intervalMs, bootDelayMs: opts.bootDelayMs ?? 90_000, tick }),
  };
}
