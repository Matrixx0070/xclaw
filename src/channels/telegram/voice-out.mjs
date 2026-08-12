/**
 * Telegram voice-note replies (P2).
 * Prefer local TTS (piper / espeak-ng); optional seat Voice later.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { localSpeak } from "../../voice/providers/local.mjs";

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/**
 * Convert wav → ogg opus for Telegram sendVoice when ffmpeg exists.
 * @param {string} wavPath
 * @returns {Promise<string|null>} ogg path or null
 */
export async function wavToOggOpus(wavPath) {
  const out = wavPath.replace(/\.wav$/i, "") + ".ogg";
  const r = await run("ffmpeg", [
    "-y",
    "-i",
    wavPath,
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    out,
  ]);
  if (r.code !== 0) return null;
  try {
    await fs.access(out);
    return out;
  } catch {
    return null;
  }
}

/**
 * Synthesize speech for a reply.
 * @param {string} text
 * @param {object} cfg
 * @param {object} [voiceConf] channels.telegram.voiceOut
 */
export async function synthesizeReplyVoice(text, cfg = {}, voiceConf = {}) {
  const maxChars = Number(voiceConf.maxChars) > 0 ? Number(voiceConf.maxChars) : 400;
  const slice = String(text || "").trim().slice(0, maxChars);
  if (!slice) return { ok: false, reason: "empty" };

  const spoken = await localSpeak(slice, cfg);
  if (!spoken.ok) {
    return { ok: false, reason: spoken.error || "tts_failed", provider: spoken.provider };
  }

  let audioPath = spoken.path;
  let format = "wav";
  const ogg = await wavToOggOpus(spoken.path);
  if (ogg) {
    audioPath = ogg;
    format = "ogg";
  }

  return {
    ok: true,
    path: audioPath,
    format,
    provider: spoken.provider,
    text: slice,
  };
}

/**
 * Send voice note via Telegram Bot API (multipart).
 * @param {object} opts
 * @param {string} opts.token
 * @param {string|number} opts.chatId
 * @param {string} opts.filePath
 * @param {number} [opts.replyTo]
 * @param {string} [opts.caption]
 * @param {string} [opts.format] wav|ogg
 */
export async function sendTelegramVoiceNote(opts) {
  const token = opts.token;
  const chatId = opts.chatId;
  const filePath = opts.filePath;
  const replyTo = opts.replyTo;
  const caption = opts.caption;
  const format = opts.format || "ogg";

  const buf = await fs.readFile(filePath);
  const blob = new Blob([buf], {
    type: format === "ogg" ? "audio/ogg" : "audio/wav",
  });
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (replyTo != null) form.append("reply_to_message_id", String(replyTo));
  if (caption) form.append("caption", String(caption).slice(0, 1024));

  const filename = path.basename(filePath);
  if (format === "ogg") {
    form.append("voice", blob, filename.endsWith(".ogg") ? filename : "voice.ogg");
    const url = `https://api.telegram.org/bot${token}/sendVoice`;
    const res = await fetch(url, { method: "POST", body: form });
    const j = await res.json();
    if (!j.ok) {
      // fallback: send as document
      return sendAsDocument({ token, chatId, filePath, replyTo, caption, buf, filename });
    }
    return { ok: true, method: "sendVoice", result: j.result };
  }

  return sendAsDocument({ token, chatId, filePath, replyTo, caption, buf, filename });
}

async function sendAsDocument({ token, chatId, filePath, replyTo, caption, buf, filename }) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (replyTo != null) form.append("reply_to_message_id", String(replyTo));
  if (caption) form.append("caption", String(caption).slice(0, 1024));
  const blob = new Blob([buf || (await fs.readFile(filePath))]);
  form.append("document", blob, filename || "voice.wav");
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  const res = await fetch(url, { method: "POST", body: form });
  const j = await res.json();
  if (!j.ok) {
    throw new Error(`Telegram sendDocument: ${j.description || res.status}`);
  }
  return { ok: true, method: "sendDocument", result: j.result };
}

/**
 * @param {object} conf channels.telegram
 */
export function isVoiceOutEnabled(conf = {}) {
  const v = conf.voiceOut;
  if (v === false) return false;
  if (v === true) return true;
  if (v && typeof v === "object") return v.enabled === true;
  return false; // opt-in
}

export function voiceOutOptions(conf = {}) {
  const v = conf.voiceOut && typeof conf.voiceOut === "object" ? conf.voiceOut : {};
  return {
    enabled: isVoiceOutEnabled(conf),
    /** always | on_request | never — on_request if user message has /voice or voice note */
    mode: v.mode || "on_request",
    maxChars: Number(v.maxChars) > 0 ? Number(v.maxChars) : 400,
    caption: v.caption !== false,
  };
}

export default {
  synthesizeReplyVoice,
  sendTelegramVoiceNote,
  wavToOggOpus,
  isVoiceOutEnabled,
  voiceOutOptions,
};
