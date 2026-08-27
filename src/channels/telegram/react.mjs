/**
 * Telegram reaction payload (spec §16.3 wiring).
 *
 * Telegram sets the bot's whole reaction list per message: an add is
 * `reaction: [{ type: "emoji", emoji }]`, and remove / clear-all are an
 * empty list. Pure — the channel adapter and the live self-test both
 * build the exact call through here.
 */
export function buildReactionCall({ chatId, messageId, op, emoji }) {
  const reaction = op === "add" ? [{ type: "emoji", emoji: String(emoji) }] : [];
  return {
    method: "setMessageReaction",
    body: {
      chat_id: chatId,
      message_id: Number(messageId),
      reaction,
    },
  };
}
