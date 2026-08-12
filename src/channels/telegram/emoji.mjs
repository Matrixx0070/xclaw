/**
 * Emoji helpers for stickers, dice, custom emoji entities.
 */

/** Allowed dice emoji per Telegram Bot API */
export const DICE_EMOJI = ["🎲", "🎯", "🏀", "⚽", "🎳", "🎰"];

/**
 * @param {string} emoji
 */
export function isValidDiceEmoji(emoji) {
  return DICE_EMOJI.includes(String(emoji || ""));
}

/**
 * Normalize dice emoji or default 🎲
 */
export function normalizeDiceEmoji(emoji) {
  const e = String(emoji || "").trim();
  return isValidDiceEmoji(e) ? e : "🎲";
}

/**
 * Extract custom emoji ids from message entities.
 * @param {object} msg
 * @returns {{ id: string, offset: number, length: number }[]}
 */
export function extractCustomEmojiEntities(msg) {
  const out = [];
  const text = msg?.text || msg?.caption || "";
  const entities = [
    ...(msg?.entities || []),
    ...(msg?.caption_entities || []),
  ];
  for (const ent of entities) {
    if (ent.type === "custom_emoji" && ent.custom_emoji_id) {
      out.push({
        id: String(ent.custom_emoji_id),
        offset: ent.offset ?? 0,
        length: ent.length ?? 0,
        preview: text.slice(ent.offset, (ent.offset || 0) + (ent.length || 0)),
      });
    }
  }
  return out;
}

/**
 * Human label for sticker emoji + set.
 */
export function formatStickerEmojiLabel(sticker = {}) {
  const emoji = sticker.emoji || sticker.custom_emoji || "";
  const set = sticker.set_name || sticker.setName || "";
  const parts = [];
  if (emoji) parts.push(emoji);
  if (set) parts.push(`set:${set}`);
  if (sticker.is_animated || sticker.isAnimated) parts.push("animated");
  if (sticker.is_video || sticker.isVideo) parts.push("video");
  if (sticker.premium_animation || sticker.premiumAnimation) parts.push("premium");
  return parts.join(" · ") || "sticker";
}

/**
 * Count extended grapheme clusters roughly for emoji-heavy captions.
 * Prefers Intl.Segmenter when available.
 */
export function countEmojiGraphemes(str) {
  const s = String(str || "");
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    let n = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)) {
      n += 1;
    }
    return n;
  }
  return Array.from(s).length;
}

export default {
  DICE_EMOJI,
  isValidDiceEmoji,
  normalizeDiceEmoji,
  extractCustomEmojiEntities,
  formatStickerEmojiLabel,
  countEmojiGraphemes,
};
