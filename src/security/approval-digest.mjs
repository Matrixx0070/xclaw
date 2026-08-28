/**
 * Approval digests — summarize aged pending approvals for operators.
 */
import { getSharedApprovalGate } from "./approvals.mjs";
import { deliverToChannel } from "../cron/channel-deliver.mjs";
import { buildRoutedApprovalDigest } from "./approval-digest-route.mjs";

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
