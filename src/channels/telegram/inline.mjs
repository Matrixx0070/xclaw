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

/**
 * Human text for a pending tool approval.
 */
export function formatPendingApprovalText(item) {
  const tool = item?.tool || "?";
  const args = item?.args ? JSON.stringify(item.args).slice(0, 400) : "";
  return [
    "🔐 *Approval required*",
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
};
