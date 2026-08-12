/**
 * Approval digests — summarize aged pending approvals for operators.
 */
import { getSharedApprovalGate } from "./approvals.mjs";
import { deliverToChannel } from "../cron/channel-deliver.mjs";

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
    lines.push(`- ${p.id} ${p.tool} age=${age} ${left}`);
  }
  if (!pending.length) lines.push("(none)");
  return {
    text: lines.join("\n"),
    pending: pending.length,
    aged: aged.length,
    items: pending,
  };
}

export async function sendApprovalDigest(cfg) {
  const digest = buildApprovalDigest(cfg);
  if (!digest.pending && cfg?.security?.digestOnlyIfPending !== false) {
    return { sent: false, reason: "empty", digest };
  }
  const targets = cfg?.security?.digestTargets || cfg?.alerting?.targets || [];
  if (!targets.length) {
    return { sent: false, reason: "no_targets", digest };
  }
  for (const t of targets) {
    try {
      await deliverToChannel(cfg, t, digest.text);
    } catch (err) {
      console.error("[xclaw:digest]", err.message);
    }
  }
  return { sent: true, digest };
}
