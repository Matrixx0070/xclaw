/**
 * Shared conversation glyph planning (spec §16.2).
 *
 * One bot reaction per target message unless the channel allows many.
 * Pure planning + a thin apply that needs an adapter with `react`.
 * NOT wired to the live message tool in this binary (spec §16.3 wiring
 * is a separate slice). Inbound Telegram emoji handling stays in
 * src/channels/telegram/emoji.mjs; TTS glyph stripping stays in
 * src/voice/speakable.mjs.
 */

export const ACK_FALLBACK = "eyes";

export function normalizeGlyph(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

/**
 * Channel rules for add/remove.
 * empty glyph = remove all of *this bot's* reactions where the channel allows it.
 */
export function planGlyphAction({ channel, glyph, remove = false, clearAll = false }) {
  const emoji = normalizeGlyph(glyph);
  const ch = String(channel || "").toLowerCase();

  if (ch === "nextcloud") {
    if (remove || !emoji) {
      return { ok: false, error: "this channel only supports adding a non-empty glyph" };
    }
    return { ok: true, op: "add", emoji };
  }

  if (ch === "imessage") {
    const kinds = new Set(["love", "like", "dislike", "laugh", "emphasize", "question"]);
    if (remove && !kinds.has(emoji)) return { ok: true, op: "clear-all" };
    if (remove) return { ok: true, op: "remove", emoji };
    if (!emoji) return { ok: true, op: "clear-all" };
    return { ok: true, op: "add", emoji };
  }

  if (ch === "whatsapp") {
    if (!emoji || remove) return { ok: true, op: "clear-one" };
    return { ok: true, op: "replace", emoji };
  }

  if (ch === "feishu" || ch === "lark") {
    if (clearAll || (!emoji && remove)) return { ok: true, op: "clear-all" };
    if (remove) {
      if (!emoji) return { ok: false, error: "remove needs a non-empty glyph" };
      return { ok: true, op: "remove", emoji };
    }
    if (!emoji) return { ok: false, error: "add needs a non-empty glyph" };
    return { ok: true, op: "add", emoji };
  }

  // telegram, discord, slack, signal, matrix default
  if (!emoji) return { ok: true, op: "clear-all" };
  if (remove) return { ok: true, op: "remove", emoji };
  return { ok: true, op: "add", emoji };
}

export function resolveAckGlyph({ ackConfig, identityGlyph } = {}) {
  if (!ackConfig) return "";
  const configured = typeof ackConfig === "string" ? ackConfig : ackConfig.emoji;
  return normalizeGlyph(configured) || normalizeGlyph(identityGlyph) || ACK_FALLBACK;
}

export async function applyConversationGlyph({ adapter, channel, messageId, glyph, remove, clearAll }) {
  const plan = planGlyphAction({ channel, glyph, remove, clearAll });
  if (!plan.ok) throw new Error(plan.error);
  if (!adapter?.react) throw new Error(`channel ${channel} has no react adapter`);
  return adapter.react({ messageId, ...plan });
}
