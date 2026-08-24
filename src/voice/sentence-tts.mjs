/**
 * Sentence-flush TTS — speak reply in chunks for lower time-to-first-audio.
 *
 * For complete text: split on sentence boundaries, synthesize+play each in order.
 * For token streams: pushDelta() accumulates and flushes on .?! boundaries.
 * Barge-in / epoch change aborts the queue.
 */

import { localSpeak } from "./providers/local.mjs";
import { toSpeakableText } from "./speakable.mjs";
import { playWav } from "./playback.mjs";

const SENTENCE_END = /(?<=[.!?…])\s+/;

/**
 * Split text into speakable sentences (keeps punctuation).
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const parts = t.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) {
    // Also flush on long commas / length for very long clauses
    if (t.length > 180) {
      const soft = [];
      let buf = "";
      for (const w of t.split(" ")) {
        buf = buf ? `${buf} ${w}` : w;
        if (buf.length >= 140 && /[,;:]$/.test(buf)) {
          soft.push(buf.trim());
          buf = "";
        }
      }
      if (buf.trim()) soft.push(buf.trim());
      return soft.length ? soft : [t];
    }
    return [t];
  }
  return parts;
}

/**
 * Speak sentences sequentially; stops on barge-in / suppress.
 * @param {string} text
 * @param {object} cfg
 * @param {{ speech?: object, maxChars?: number, onSentence?: Function }} [opts]
 */
export async function speakSentences(text, cfg = {}, opts = {}) {
  const speech = opts.speech;
  const maxChars = opts.maxChars ?? 400;
  const sentences = splitSentences(String(text || "").slice(0, maxChars * 3));
  const spoken = [];
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let firstAudioMs = null;

  for (const sentence of sentences) {
    if (speech?.isSuppressed?.()) {
      return {
        ok: false,
        interrupted: true,
        reason: "suppressed",
        spoken,
        firstAudioMs,
      };
    }
    const begin = speech?.beginSpeak?.(sentence) || { ok: true, epoch: speech?.getEpoch?.() };
    if (!begin.ok) {
      return {
        ok: false,
        interrupted: true,
        reason: begin.reason || "begin_failed",
        spoken,
        firstAudioMs,
      };
    }
    const speakable = toSpeakableText(sentence, { maxChars });
    if (!speakable) {
      speech?.endSpeak?.(begin.epoch);
      continue;
    }
    const syn = await localSpeak(speakable, cfg);
    if (!syn.ok) {
      speech?.endSpeak?.(begin.epoch);
      continue;
    }
    if (firstAudioMs == null) {
      firstAudioMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    }
    const play = await playWav(syn.path, {
      speech,
      epoch: begin.epoch,
    });
    spoken.push({
      text: sentence,
      provider: syn.provider,
      interrupted: Boolean(play?.interrupted),
    });
    if (play?.interrupted) {
      return {
        ok: false,
        interrupted: true,
        reason: play.reason || "barge_in",
        spoken,
        firstAudioMs,
      };
    }
    opts.onSentence?.({ sentence, play });
  }

  return {
    ok: true,
    spoken,
    sentences: sentences.length,
    firstAudioMs,
  };
}

/**
 * Streaming flusher: call push(delta) as tokens arrive; await end().
 */
export function createSentenceStreamSpeaker(cfg = {}, opts = {}) {
  let buf = "";
  let queue = Promise.resolve();
  let stopped = false;
  const speech = opts.speech;

  function flushReady() {
    const parts = splitSentences(buf);
    if (parts.length <= 1) return;
    // Keep last incomplete fragment in buf
    const complete = parts.slice(0, -1);
    buf = parts[parts.length - 1] || "";
    for (const s of complete) {
      queue = queue.then(async () => {
        if (stopped || speech?.isSuppressed?.()) return;
        await speakSentences(s, cfg, opts);
      });
    }
  }

  return {
    push(delta) {
      if (stopped) return;
      buf += String(delta || "");
      flushReady();
    },
    async end() {
      const rest = buf.trim();
      buf = "";
      if (rest && !stopped) {
        queue = queue.then(() => speakSentences(rest, cfg, opts));
      }
      return queue;
    },
    stop() {
      stopped = true;
      speech?.bargeIn?.({ reason: "stream_stop" });
    },
  };
}

export default {
  splitSentences,
  speakSentences,
  createSentenceStreamSpeaker,
};
