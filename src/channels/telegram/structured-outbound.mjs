import { normalizeDiceEmoji } from "./emoji.mjs";
/**
 * Telegram outbound structured media (P4).
 * Parse agent reply for embedded telegram payloads and send via Bot API.
 *
 * Supported fences in reply text:
 *   ```telegram
 *   {"type":"location","latitude":24.86,"longitude":67.0}
 *   ```
 *
 * Types: location | venue | contact | poll | dice | sticker | animation | photo | document
 */

const FENCE_RE =
  /```(?:telegram|tg)\s*\n([\s\S]*?)```/gi;

/**
 * Extract structured payloads and strip fences from text.
 * @param {string} text
 * @returns {{ text: string, payloads: object[] }}
 */
export function parseOutboundStructured(text) {
  const payloads = [];
  let cleaned = String(text || "");
  cleaned = cleaned.replace(FENCE_RE, (_, body) => {
    const raw = String(body || "").trim();
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const p of parsed) if (p && typeof p === "object") payloads.push(p);
      } else if (parsed && typeof parsed === "object") {
        payloads.push(parsed);
      }
    } catch {
      // try line-delimited JSON
      for (const line of raw.split("\n")) {
        const s = line.trim();
        if (!s) continue;
        try {
          const p = JSON.parse(s);
          if (p && typeof p === "object") payloads.push(p);
        } catch {
          /* ignore bad line */
        }
      }
    }
    return "";
  });
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, payloads };
}

/**
 * Normalize a payload into Bot API method + body.
 * @param {object} p
 * @param {string|number} chatId
 * @param {number} [replyTo]
 * @returns {{ method: string, body: object } | null}
 */
export function payloadToApiCall(p, chatId, replyTo) {
  if (!p || typeof p !== "object") return null;
  const type = String(p.type || p.kind || "").toLowerCase();
  const base = { chat_id: chatId };
  if (replyTo != null) base.reply_to_message_id = replyTo;

  switch (type) {
    case "location": {
      const lat = Number(p.latitude ?? p.lat);
      const lon = Number(p.longitude ?? p.lon ?? p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const body = { ...base, latitude: lat, longitude: lon };
      if (p.horizontal_accuracy != null || p.horizontalAccuracy != null) {
        body.horizontal_accuracy = Number(
          p.horizontal_accuracy ?? p.horizontalAccuracy
        );
      }
      if (p.live_period != null || p.livePeriod != null) {
        body.live_period = Number(p.live_period ?? p.livePeriod);
      }
      if (p.heading != null) body.heading = Number(p.heading);
      if (p.proximity_alert_radius != null) {
        body.proximity_alert_radius = Number(p.proximity_alert_radius);
      }
      return { method: "sendLocation", body };
    }
    case "venue": {
      const lat = Number(p.latitude ?? p.lat ?? p.location?.latitude);
      const lon = Number(
        p.longitude ?? p.lon ?? p.lng ?? p.location?.longitude
      );
      const title = p.title || "Venue";
      const address = p.address || "";
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const body = {
        ...base,
        latitude: lat,
        longitude: lon,
        title: String(title).slice(0, 128),
        address: String(address).slice(0, 256),
      };
      if (p.foursquare_id || p.foursquareId) {
        body.foursquare_id = p.foursquare_id || p.foursquareId;
      }
      if (p.google_place_id || p.googlePlaceId) {
        body.google_place_id = p.google_place_id || p.googlePlaceId;
      }
      return { method: "sendVenue", body };
    }
    case "contact": {
      const phone = p.phone_number || p.phoneNumber || p.phone;
      const first = p.first_name || p.firstName || "Contact";
      if (!phone) return null;
      const body = {
        ...base,
        phone_number: String(phone),
        first_name: String(first).slice(0, 64),
      };
      if (p.last_name || p.lastName) {
        body.last_name = String(p.last_name || p.lastName).slice(0, 64);
      }
      if (p.vcard) body.vcard = String(p.vcard).slice(0, 2048);
      return { method: "sendContact", body };
    }
    case "poll": {
      const question = p.question || p.q;
      let options = p.options || p.choices || [];
      if (typeof options === "string") {
        options = options.split("|").map((s) => s.trim());
      }
      options = options.map((o) => (typeof o === "string" ? o : o?.text)).filter(Boolean);
      if (!question || options.length < 2) return null;
      const body = {
        ...base,
        question: String(question).slice(0, 300),
        options: options.slice(0, 10).map((o) => String(o).slice(0, 100)),
        is_anonymous: p.is_anonymous !== false && p.isAnonymous !== false,
        type: p.pollType || p.poll_type || "regular",
      };
      if (p.allows_multiple_answers || p.allowsMultiple) {
        body.allows_multiple_answers = true;
      }
      if (body.type === "quiz" && (p.correct_option_id != null || p.correctOptionId != null)) {
        body.correct_option_id = Number(
          p.correct_option_id ?? p.correctOptionId
        );
      }
      return { method: "sendPoll", body };
    }
    case "dice": {
      const body = { ...base, emoji: normalizeDiceEmoji(p.emoji) };
      return { method: "sendDice", body };
    }
    case "sticker": {
      const fileId = p.file_id || p.fileId || p.sticker;
      if (!fileId || typeof fileId !== "string") return null;
      // only file_id reuse (no upload path here — keep JSON API)
      return {
        method: "sendSticker",
        body: { ...base, sticker: fileId },
      };
    }
    case "animation": {
      const fileId = p.file_id || p.fileId || p.animation;
      if (!fileId || typeof fileId !== "string") return null;
      const body = { ...base, animation: fileId };
      if (p.caption) body.caption = String(p.caption).slice(0, 1024);
      return { method: "sendAnimation", body };
    }
    case "photo": {
      const fileId = p.file_id || p.fileId || p.photo;
      if (!fileId || typeof fileId !== "string") return null;
      const body = { ...base, photo: fileId };
      if (p.caption) body.caption = String(p.caption).slice(0, 1024);
      return { method: "sendPhoto", body };
    }
    case "document": {
      const fileId = p.file_id || p.fileId || p.document;
      if (!fileId || typeof fileId !== "string") return null;
      const body = { ...base, document: fileId };
      if (p.caption) body.caption = String(p.caption).slice(0, 1024);
      return { method: "sendDocument", body };
    }
    case "venue_from_text":
    case "text":
      return null;
    default:
      return null;
  }
}

/**
 * Send all payloads via api(method, body).
 * @param {object} opts
 * @param {(method: string, body: object) => Promise<any>} opts.api
 * @param {string|number} opts.chatId
 * @param {number} [opts.replyTo]
 * @param {object[]} opts.payloads
 * @returns {Promise<{ sent: number, errors: string[] }>}
 */
export async function sendStructuredOutbound(opts) {
  const { api, chatId, replyTo, payloads } = opts;
  let sent = 0;
  const errors = [];
  for (const p of payloads || []) {
    const call = payloadToApiCall(p, chatId, replyTo);
    if (!call) {
      errors.push(`unsupported_or_invalid:${p?.type || "?"}`);
      continue;
    }
    try {
      await api(call.method, call.body);
      sent += 1;
    } catch (err) {
      errors.push(`${call.method}:${err.message || err}`);
    }
  }
  return { sent, errors };
}

/**
 * Parse reply + send structured parts; returns cleaned text for normal send.
 */
export async function deliverStructuredReply(opts) {
  const { api, chatId, replyTo, text } = opts;
  const { text: cleaned, payloads } = parseOutboundStructured(text);
  const result =
    payloads.length > 0
      ? await sendStructuredOutbound({ api, chatId, replyTo, payloads })
      : { sent: 0, errors: [] };
  return { text: cleaned, ...result, payloadCount: payloads.length };
}

export default {
  parseOutboundStructured,
  payloadToApiCall,
  sendStructuredOutbound,
  deliverStructuredReply,
};
