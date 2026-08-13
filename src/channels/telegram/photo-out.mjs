/**
 * Send a local image file to a Telegram chat via multipart sendPhoto (Bot API),
 * falling back to sendDocument if Telegram rejects the photo (e.g. too large or
 * an unsupported format). Mirrors voice-out.mjs. Used to deliver images the
 * agent produced (generate_image / edit_image) to the user's chat.
 */
import fs from "node:fs/promises";
import path from "node:path";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** True for a path that looks like a deliverable image. */
export function isImagePath(p) {
  return typeof p === "string" && IMAGE_EXT.test(p);
}

/**
 * @param {object} args
 * @param {string} args.token bot token
 * @param {string|number} args.chatId
 * @param {string} args.filePath local image file
 * @param {string|number} [args.replyTo] message id to reply to
 * @param {string} [args.caption]
 */
export async function sendPhotoFile({ token, chatId, filePath, replyTo, caption }) {
  let buf;
  try {
    buf = await fs.readFile(filePath);
  } catch (e) {
    return { ok: false, error: `read failed: ${e.message}` };
  }
  const filename = path.basename(filePath);
  const cap = caption ? String(caption).slice(0, 1024) : undefined;

  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (replyTo != null) form.append("reply_to_message_id", String(replyTo));
  if (cap) form.append("caption", cap);
  form.append("photo", new Blob([buf]), filename);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const j = await res.json();
    if (j.ok) return { ok: true, method: "sendPhoto", result: j.result };
    // Fallback: deliver as a document (preserves the file even if photo is refused).
    return sendAsDocument({ token, chatId, filePath, replyTo, caption: cap, buf, filename });
  } catch (e) {
    return sendAsDocument({ token, chatId, filePath, replyTo, caption: cap, buf, filename }).catch(
      () => ({ ok: false, error: e.message })
    );
  }
}

async function sendAsDocument({ token, chatId, filePath, replyTo, caption, buf, filename }) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (replyTo != null) form.append("reply_to_message_id", String(replyTo));
  if (caption) form.append("caption", String(caption).slice(0, 1024));
  form.append("document", new Blob([buf || (await fs.readFile(filePath))]), filename || "image.png");
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: "POST",
      body: form,
    });
    const j = await res.json();
    return j.ok
      ? { ok: true, method: "sendDocument", result: j.result }
      : { ok: false, error: j.description || "sendDocument failed" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export default { sendPhotoFile, isImagePath };
