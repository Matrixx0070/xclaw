/**
 * Telegram inline keyboards for pairing + tool approvals (P0).
 */

/**
 * Pairing approve/deny keyboard for owner.
 * @param {{ code: string, chatId: string|number }} p
 */
export function pairingInlineKeyboard({ code, chatId }) {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Approve",
          callback_data: `xclaw:pair:approve:${code}`.slice(0, 64),
        },
        {
          text: "❌ Deny",
          callback_data: `xclaw:pair:deny:${code}`.slice(0, 64),
        },
      ],
    ],
  };
}

/**
 * Tool approval keyboard.
 * @param {{ pendingId: string, tool?: string }} p
 */
export function approvalInlineKeyboard({ pendingId, tool }) {
  const id = String(pendingId).slice(0, 40);
  return {
    inline_keyboard: [
      [
        {
          text: `✅ Allow ${tool ? String(tool).slice(0, 20) : ""}`.trim(),
          callback_data: `xclaw:apr:ok:${id}`.slice(0, 64),
        },
        {
          text: "❌ Deny",
          callback_data: `xclaw:apr:no:${id}`.slice(0, 64),
        },
      ],
    ],
  };
}

/**
 * Parse callback_data from inline buttons.
 * @param {string} data
 * @returns {{ kind: string, action?: string, id?: string } | null}
 */
export function parseCallbackData(data) {
  const s = String(data || "");
  if (!s.startsWith("xclaw:")) return null;
  const parts = s.split(":");
  // xclaw:pair:approve:CODE | xclaw:apr:ok:ID
  if (parts[1] === "pair" && parts[2] && parts[3]) {
    return { kind: "pair", action: parts[2], id: parts.slice(3).join(":") };
  }
  if (parts[1] === "apr" && parts[2] && parts[3]) {
    return { kind: "apr", action: parts[2], id: parts.slice(3).join(":") };
  }
  // xclaw:sug:ID
  if (parts[1] === "sug" && parts[2]) {
    return { kind: "sug", action: "run", id: parts.slice(2).join(":") };
  }
  return null;
}

export const TIER_LABEL = {
  critical: "\u{1F6D1} CRITICAL",
  high: "\u26A0\uFE0F HIGH",
  risky: "\u26A0\uFE0F RISKY",
  medium: "MEDIUM",
  low: "LOW",
  safe: "SAFE",
};

/**
 * The tier reaches this module in two shapes: `listPending()` returns the whole
 * risk object on `item.risk`, while the `approval_required` event flattens it
 * to `item.riskTier`. Both normalise here so a third caller cannot invent a
 * third shape.
 */
function riskTierOf(item) {
  const t = item?.risk?.tier ?? item?.riskTier;
  return typeof t === "string" && t ? t : null;
}

/**
 * Narrow an `approval_required` event to the fields the prompt renders.
 *
 * This is the transit hop the tier used to be dropped at: the handler built
 * `{id, tool, args}` by hand, which is narrower than what the loop emitted, so
 * the severity never reached the only human in the loop. Keep it a pure
 * function so the carry can be tested without a Telegram client.
 */
export function approvalItemFromEvent(e) {
  return {
    id: e?.pendingId ?? null,
    tool: e?.name ?? null,
    args: e?.args,
    riskTier: riskTierOf({ riskTier: e?.riskTier, risk: e?.risk }),
  };
}

/**
 * Human text for a pending tool approval.
 *
 * The tier is rendered; the reasons deliberately are NOT. `assessRisk`'s
 * reasons are filesystem-shaped and are fabricated for third-party tools that
 * touch no file at all — a Linear issue creation reports "writes outside
 * workspace (home)". Mixed-accuracy text in a security prompt is worse than
 * absent text; the tier itself is correct, so ship only the tier.
 */
export function formatPendingApprovalText(item) {
  const tool = item?.tool || "?";
  const args = item?.args ? JSON.stringify(item.args).slice(0, 400) : "";
  const tier = riskTierOf(item);
  return [
    "🔐 *Approval required*",
    tier ? `Risk: ${TIER_LABEL[tier] || tier.toUpperCase()}` : null,
    `Tool: \`${tool}\``,
    item?.id ? `Id: \`${item.id}\`` : null,
    args ? `Args: \`${args}\`` : null,
    "",
    "Tap Allow or Deny.",
  ]
    .filter(Boolean)
    .join("\n");
}

export default {
  pairingInlineKeyboard,
  approvalInlineKeyboard,
  parseCallbackData,
  formatPendingApprovalText,
  approvalItemFromEvent,
};
