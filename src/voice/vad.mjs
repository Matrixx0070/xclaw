/**
 * Energy-based VAD endpointing for local mic capture.
 *
 * Streams arecord raw S16_LE mono → frame RMS → detect speech start/end.
 * Ends utterance after `silenceMs` of below-threshold frames once speech seen.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * @param {Buffer} pcm S16_LE samples
 * @returns {number} RMS
 */
export function pcmRms(pcm) {
  if (!pcm || pcm.length < 2) return 0;
  const n = Math.floor(pcm.length / 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/**
 * Build a minimal 16-bit mono WAV buffer from PCM.
 */
export function pcmToWav(pcm, sampleRate = 16000) {
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // pcm fmt chunk
  buf.writeUInt16LE(1, 20); // audio format PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

export function vadConfig(cfg = {}, opts = {}) {
  const v = cfg.voice?.vad || cfg.vad || {};
  return {
    sampleRate: Number(opts.sampleRate || v.sampleRate || 16000),
    /** Frame length in ms for RMS */
    frameMs: Number(opts.frameMs || v.frameMs || 30),
    /** RMS threshold for "speech" (S16 scale) */
    threshold: Number(opts.threshold || v.threshold || cfg.voice?.wake?.energyThreshold || 500),
    /** Silence duration after speech to endpoint */
    silenceMs: Number(opts.silenceMs || v.silenceMs || 450),
    /** Max utterance length */
    maxMs: Number(opts.maxMs || v.maxMs || 8000),
    /** Wait this long for speech to start before giving up */
    prerosMs: Number(opts.prerollMs || opts.prerosMs || v.prerollMs || 2500),
    /** Minimum speech before allowing endpoint */
    minSpeechMs: Number(opts.minSpeechMs || v.minSpeechMs || 120),
  };
}

/**
 * Record until VAD endpoint (or max/preroll timeout).
 * @returns {Promise<{ ok: boolean, path?: string, reason?: string, durationMs?: number, speechMs?: number, energyPeak?: number, error?: string }>}
 */
export async function recordUntilEndpoint(opts = {}) {
  const c = vadConfig(opts.cfg || {}, opts);
  const frameBytes = Math.floor((c.sampleRate * c.frameMs) / 1000) * 2;
  const silenceFrames = Math.max(1, Math.ceil(c.silenceMs / c.frameMs));
  const maxFrames = Math.ceil(c.maxMs / c.frameMs);
  const prerollFrames = Math.ceil(c.prerosMs / c.frameMs);
  const minSpeechFrames = Math.ceil(c.minSpeechMs / c.frameMs);

  const outPath =
    opts.path ||
    path.join(os.tmpdir(), `xclaw-vad-${Date.now()}.wav`);

  return new Promise((resolve) => {
    const child = spawn(
      "arecord",
      [
        "-f",
        "S16_LE",
        "-r",
        String(c.sampleRate),
        "-c",
        "1",
        "-t",
        "raw",
        "-q",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const chunks = [];
    let pending = Buffer.alloc(0);
    let frames = 0;
    let speechFrames = 0;
    let silentRun = 0;
    let seenSpeech = false;
    let peak = 0;
    let done = false;
    const t0 = Date.now();

    const finish = async (reason) => {
      if (done) return;
      done = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
      const pcm = Buffer.concat(chunks);
      const durationMs = Date.now() - t0;
      const speechMs = speechFrames * c.frameMs;
      if (pcm.length < frameBytes || (!seenSpeech && reason !== "force")) {
        resolve({
          ok: false,
          reason: reason || "no_speech",
          durationMs,
          speechMs,
          energyPeak: Math.round(peak),
          error: seenSpeech ? undefined : "no speech detected",
        });
        return;
      }
      try {
        const wav = pcmToWav(pcm, c.sampleRate);
        await fs.writeFile(outPath, wav);
        resolve({
          ok: true,
          path: outPath,
          reason: reason || "endpoint",
          durationMs,
          speechMs,
          energyPeak: Math.round(peak),
          frames,
          threshold: c.threshold,
          silenceMs: c.silenceMs,
        });
      } catch (e) {
        resolve({
          ok: false,
          reason: "write_failed",
          error: e.message || String(e),
          durationMs,
        });
      }
    };

    child.on("error", (err) => {
      if (done) return;
      done = true;
      resolve({
        ok: false,
        reason: "arecord_error",
        error: err.message || String(err),
      });
    });

    child.stdout.on("data", (d) => {
      if (done) return;
      pending = Buffer.concat([pending, d]);
      while (pending.length >= frameBytes) {
        const frame = pending.subarray(0, frameBytes);
        pending = pending.subarray(frameBytes);
        chunks.push(Buffer.from(frame));
        frames += 1;
        const rms = pcmRms(frame);
        if (rms > peak) peak = rms;
        const isSpeech = rms >= c.threshold;
        if (isSpeech) {
          seenSpeech = true;
          speechFrames += 1;
          silentRun = 0;
        } else if (seenSpeech) {
          silentRun += 1;
          if (
            speechFrames >= minSpeechFrames &&
            silentRun >= silenceFrames
          ) {
            void finish("silence");
            return;
          }
        }
        if (frames >= maxFrames) {
          void finish("max_duration");
          return;
        }
        if (!seenSpeech && frames >= prerollFrames) {
          void finish("preroll_timeout");
          return;
        }
      }
    });

    // Safety timer
    const timer = setTimeout(() => void finish("max_duration"), c.maxMs + 500);
    if (timer.unref) timer.unref();
    child.on("close", () => {
      clearTimeout(timer);
      if (!done) void finish("stream_end");
    });
  });
}

export default {
  pcmRms,
  pcmToWav,
  vadConfig,
  recordUntilEndpoint,
};
