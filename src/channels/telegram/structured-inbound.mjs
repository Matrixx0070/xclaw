/**
 * Structured Telegram inbound (P3): stickers, location, contact, venue, poll, etc.
 * Produces human-readable agent text + structured meta for tools/memory.
 */
import { normalizeStickerMeta, stickerMetaToTextParts } from "./sticker-meta.mjs";
import { extractCustomEmojiEntities } from "./emoji.mjs";

/**
 * Types we treat as "contentful" even without text/caption.
 */
export const STRUCTURED_FIELDS = [
  "sticker",
  "animation",
  "video_note",
  "location",
  "venue",
  "contact",
  "poll",
  "dice",
  "game",
];

/**
 * @param {object} msg Telegram message
 */
export function hasStructuredContent(msg) {
  if (!msg) return false;
  return STRUCTURED_FIELDS.some((k) => msg[k] != null);
}

/**
 * @param {object} msg
 * @returns {{ textParts: string[], structured: object[] }}
 */
export function extractStructuredInbound(msg) {
  const textParts = [];
  const structured = [];
  if (!msg) return { textParts, structured };

  if (msg.sticker) {
    const item = normalizeStickerMeta(msg.sticker);
    if (item) {
      structured.push(item);
      textParts.push(...stickerMetaToTextParts(item));
    }
  }

  // Custom emoji in text/caption entities
  const customEmojis = extractCustomEmojiEntities(msg);
  if (customEmojis.length) {
    structured.push({
      type: "custom_emoji",
      items: customEmojis,
    });
    textParts.push(
      `[Custom emoji ×${customEmojis.length}: ${customEmojis
        .map((e) => e.preview || e.id)
        .slice(0, 8)
        .join(" ")}]`
    );
  }

  if (msg.animation) {
    const a = msg.animation;
    const item = {
      type: "animation",
      fileId: a.file_id,
      fileName: a.file_name || null,
      mime: a.mime_type || null,
      width: a.width,
      height: a.height,
      duration: a.duration,
    };
    structured.push(item);
    textParts.push(
      `[GIF/animation${a.file_name ? `: ${a.file_name}` : ""} ${a.width || "?"}x${a.height || "?"} ${a.duration || "?"}s]`
    );
  }

  if (msg.video_note) {
    const v = msg.video_note;
    structured.push({
      type: "video_note",
      fileId: v.file_id,
      length: v.length,
      duration: v.duration,
    });
    textParts.push(`[Video note ${v.duration || "?"}s]`);
  }

  if (msg.location && !msg.venue) {
    const loc = msg.location;
    const item = {
      type: "location",
      latitude: loc.latitude,
      longitude: loc.longitude,
      horizontalAccuracy: loc.horizontal_accuracy ?? null,
      livePeriod: loc.live_period ?? null,
      heading: loc.heading ?? null,
    };
    structured.push(item);
    textParts.push(
      `[Location lat=${loc.latitude} lon=${loc.longitude}${
        loc.live_period ? ` live=${loc.live_period}s` : ""
      }]`
    );
  }

  if (msg.venue) {
    const v = msg.venue;
    const loc = v.location || {};
    const item = {
      type: "venue",
      title: v.title || null,
      address: v.address || null,
      foursquareId: v.foursquare_id || null,
      googlePlaceId: v.google_place_id || null,
      latitude: loc.latitude,
      longitude: loc.longitude,
    };
    structured.push(item);
    textParts.push(
      `[Venue: ${v.title || "?"} · ${v.address || "?"}${
        loc.latitude != null ? ` @ ${loc.latitude},${loc.longitude}` : ""
      }]`
    );
  }

  if (msg.contact) {
    const c = msg.contact;
    const item = {
      type: "contact",
      phoneNumber: c.phone_number || null,
      firstName: c.first_name || null,
      lastName: c.last_name || null,
      userId: c.user_id != null ? String(c.user_id) : null,
      vcard: c.vcard || null,
    };
    structured.push(item);
    textParts.push(
      `[Contact: ${[c.first_name, c.last_name].filter(Boolean).join(" ")}${
        c.phone_number ? ` · ${c.phone_number}` : ""
      }]`
    );
  }

  if (msg.poll) {
    const p = msg.poll;
    const opts = (p.options || []).map((o) => o.text).filter(Boolean);
    const item = {
      type: "poll",
      question: p.question || null,
      options: opts,
      isAnonymous: p.is_anonymous,
      pollType: p.type || "regular",
      allowsMultiple: Boolean(p.allows_multiple_answers),
      isClosed: Boolean(p.is_closed),
    };
    structured.push(item);
    textParts.push(
      [
        `[Poll: ${p.question || "?"}]`,
        opts.length ? `options: ${opts.join(" | ")}` : null,
        p.type === "quiz" ? "quiz" : null,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (msg.dice) {
    const d = msg.dice;
    structured.push({
      type: "dice",
      emoji: d.emoji || null,
      value: d.value,
    });
    textParts.push(`[Dice ${d.emoji || "🎲"} = ${d.value}]`);
  }

  if (msg.game) {
    const g = msg.game;
    structured.push({
      type: "game",
      title: g.title || null,
      description: g.description || null,
    });
    textParts.push(`[Game: ${g.title || "?"}]`);
  }

  return { textParts, structured };
}

/**
 * Compact JSON for agent context (bounded).
 */
export function structuredToAgentHint(structured, max = 2000) {
  if (!structured?.length) return "";
  try {
    const s = JSON.stringify({ telegramStructured: structured });
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
  } catch {
    return "";
  }
}

export default {
  STRUCTURED_FIELDS,
  hasStructuredContent,
  extractStructuredInbound,
  structuredToAgentHint,
};
