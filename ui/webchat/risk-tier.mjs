/**
 * Risk tier for the webchat approval card.
 *
 * The A2 risk assessor grades every pending tool call, but the grade only has
 * value if it reaches the person being asked to approve. It did not: the stream
 * handler narrowed the `approval_required` event by hand and the card template
 * had no slot for a tier, so a `file_write` outside the workspace and a
 * read-only `get_issue` produced the same card. Telegram had the identical
 * defect (fixed in v3.352.0); this is the second operator surface.
 *
 * This module is deliberately free of DOM and of `src/` imports so it loads in
 * the browser AND in a Node test — the same arrangement `markdown.mjs` uses.
 * It duplicates Telegram's tier vocabulary because no shared module is
 * reachable from both (the browser loads `ui/` statically and cannot import
 * `src/`); `test/webchat-approval-risk-tier.test.mjs` pins the two against each
 * other so they cannot drift.
 */

/**
 * The tiers `assessRisk` produces, mapped to the severity a stylesheet can
 * render. `risky` and `high` are the same severity and different words; both
 * exist upstream, so both are named here.
 */
export const RISK_TIER_SEVERITY = {
  critical: "critical",
  high: "high",
  risky: "high",
  medium: "medium",
  low: "low",
  safe: "safe",
};

/**
 * The tier arrives in two shapes: the `approval_required` event flattens it to
 * `riskTier`, while a pending record keeps the whole object on `risk`. Both
 * normalise here so a third caller cannot invent a third shape.
 */
export function riskTierOf(item) {
  const t = item?.risk?.tier ?? item?.riskTier;
  return typeof t === "string" && t ? t : null;
}

/**
 * Narrow an `approval_required` event to the fields the card renders.
 *
 * This is the transit hop the tier was dropped at. Keep it pure so the carry is
 * testable without a browser.
 */
export function approvalCardFromEvent(e) {
  return {
    pendingId: e?.pendingId ?? null,
    name: e?.name ?? null,
    args: e?.args,
    timedOut: e?.timedOut,
    riskTier: riskTierOf({ riskTier: e?.riskTier, risk: e?.risk }),
  };
}

/**
 * The chip to render, or null when nothing is known.
 *
 * Absence renders absence: a missing tier must never be shown as "SAFE". An
 * unrecognised tier is still information, so it renders with its own name under
 * a neutral severity rather than being silently mapped onto a known one.
 *
 * Only the tier ships. `assessRisk`'s reasons are filesystem-shaped and are
 * fabricated for third-party tools that touch no file at all, and
 * mixed-accuracy text in a security prompt is worse than absent text.
 */
export function riskChip(item) {
  const tier = riskTierOf(item);
  if (!tier) return null;
  return {
    tier,
    label: tier.toUpperCase(),
    severity: RISK_TIER_SEVERITY[tier] || "unknown",
  };
}

export default { RISK_TIER_SEVERITY, riskTierOf, approvalCardFromEvent, riskChip };
