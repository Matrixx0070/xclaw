/**
 * Approval digest routing — critical items only on the critical channel.
 */
import { isCriticalRisk } from "./approval-ttl.mjs";

export function partitionDigestItems(items = [], cfg = {}) {
  const critical = [];
  const soft = [];
  for (const p of items) {
    if (isCriticalRisk(p.risk, cfg)) critical.push(p);
    else soft.push(p);
  }
  return { critical, soft };
}

export function formatDigestBucket(title, items) {
  const lines = [`${title} — ${items.length}`];
  for (const p of items.slice(0, 15)) {
    const age = p.ageMs != null ? `${Math.round(p.ageMs / 1000)}s` : "?";
    lines.push(`- ${p.id || "?"} ${p.tool || "tool"} age=${age}`);
  }
  if (!items.length) lines.push("(none)");
  return lines.join("\n");
}

export function resolveDigestTargets(cfg = {}) {
  const sec = cfg.security || {};
  const alert = cfg.alerting || {};
  const critical = sec.digestCriticalTargets || alert.criticalTargets || [];
  const soft = sec.digestTargets || alert.targets || [];
  return {
    critical: Array.isArray(critical) ? critical : [],
    soft: Array.isArray(soft) ? soft : [],
  };
}

export function buildRoutedApprovalDigest(digest, cfg = {}) {
  const items = digest?.items || [];
  const { critical, soft } = partitionDigestItems(items, cfg);
  const targets = resolveDigestTargets(cfg);
  return {
    critical: {
      items: critical,
      text: formatDigestBucket("XClaw CRITICAL approvals", critical),
      targets: targets.critical,
    },
    soft: {
      items: soft,
      text: formatDigestBucket("XClaw approval digest", soft),
      targets: targets.soft,
    },
  };
}

export default {
  partitionDigestItems,
  formatDigestBucket,
  resolveDigestTargets,
  buildRoutedApprovalDigest,
};
