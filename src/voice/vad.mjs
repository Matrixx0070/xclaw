/**
 * Energy-based Voice Activity Detection (VAD) for local mic capture.
 *
 * - Streams arecord raw S16_LE mono
 * - Per-frame RMS with open/close hysteresis
 * - Endpoints after silenceMs once speech has been seen
 * - Optional offline analyzePcmFrames() for tests / calibration
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
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);
  return buf;
}

export function vadConfig(cfg = {}, opts = {}) {
  const v = cfg.voice?.vad || cfg.vad || {};
  const baseThreshold = Number(
    opts.threshold || v.threshold || cfg.voice?.wake?.energyThreshold || 500
  );
  // Hysteresis: higher to enter speech, lower to leave (reduces chatter)
  const openThreshold = Number(
    opts.openThreshold || v.openThreshold || baseThreshold
  );
  const closeThreshold = Number(
    opts.closeThreshold ||
      v.closeThreshold ||
      Math.max(100, Math.floor(openThreshold * 0.65))
  );
  return {
    sampleRate: Number(opts.sampleRate || v.sampleRate || 16000),
    frameMs: Number(opts.frameMs || v.frameMs || 30),
    threshold: baseThreshold,
    openThreshold,
    closeThreshold,
    silenceMs: Number(opts.silenceMs || v.silenceMs || 450),
    maxMs: Number(opts.maxMs || v.maxMs || 8000),
    prerollMs: Number(opts.prerollMs || opts.prerosMs || v.prerollMs || 2500),
    minSpeechMs: Number(opts.minSpeechMs || v.minSpeechMs || 120),
    /** Require this many consecutive speech frames to lock "in speech" */
    hangoverFrames: Number(opts.hangoverFrames || v.hangoverFrames || 2),
    enabled: v.enabled !== false && opts.enabled !== false,
  };
}

/**
 * Offline frame analysis (for tests / calibration).
 * @param {Buffer} pcm
 * @param {object} [c] vadConfig result
 */
export function analyzePcmFrames(pcm, c = vadConfig({})) {
  const frameBytes = Math.floor((c.sampleRate * c.frameMs) / 1000) * 2;
  const frames = [];
  let inSpeech = false;
  let speechRun = 0;
  let silentRun = 0;
  let seenSpeech = false;
  let peak = 0;

  for (let off = 0; off + frameBytes <= pcm.length; off += frameBytes) {
    const frame = pcm.subarray(off, off + frameBytes);
    const rms = pcmRms(frame);
    if (rms > peak) peak = rms;

    if (!inSpeech) {
      if (rms >= c.openThreshold) {
        speechRun += 1;
        if (speechRun >= c.hangoverFrames) {
          inSpeech = true;
          seenSpeech = true;
          silentRun = 0;
        }
      } else {
        speechRun = 0;
      }
    } else {
      if (rms < c.closeThreshold) {
        silentRun += 1;
      } else {
        silentRun = 0;
      }
    }
    frames.push({ rms, inSpeech, silentRun });
  }

  const silenceFrames = Math.max(1, Math.ceil(c.silenceMs / c.frameMs));
  let endpointIndex = -1;
  if (seenSpeech) {
    let s = 0;
    let locked = false;
    speechRun = 0;
    for (let i = 0; i < frames.length; i++) {
      const rms = frames[i].rms;
      if (!locked) {
        if (rms >= c.openThreshold) {
          speechRun++;
          if (speechRun >= c.hangoverFrames) locked = true;
        } else speechRun = 0;
      } else if (rms < c.closeThreshold) {
        s++;
        if (s >= silenceFrames) {
          endpointIndex = i;
          break;
        }
      } else s = 0;
    }
  }

  return {
    frameCount: frames.length,
    peak: Math.round(peak),
    seenSpeech,
    endpointIndex,
    endpointMs: endpointIndex >= 0 ? endpointIndex * c.frameMs : null,
    openThreshold: c.openThreshold,
    closeThreshold: c.closeThreshold,
  };
}

/**
 * Record until VAD endpoint (or max/preroll timeout).
 */
export async function recordUntilEndpoint(opts = {}) {
  const c = vadConfig(opts.cfg || {}, opts);
  const frameBytes = Math.floor((c.sampleRate * c.frameMs) / 1000) * 2;
  const silenceFrames = Math.max(1, Math.ceil(c.silenceMs / c.frameMs));
  const maxFrames = Math.ceil(c.maxMs / c.frameMs);
  const prerollFrames = Math.ceil(c.prerollMs / c.frameMs);
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
    let speechRun = 0;
    let inSpeech = false;
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
          openThreshold: c.openThreshold,
          closeThreshold: c.closeThreshold,
          error: seenSpeech ? undefined : "no speech detected",
        });
        return;
      }
      try {
        await fs.writeFile(outPath, pcmToWav(pcm, c.sampleRate));
        resolve({
          ok: true,
          path: outPath,
          reason: reason || "endpoint",
          durationMs,
          speechMs,
          energyPeak: Math.round(peak),
          frames,
          openThreshold: c.openThreshold,
          closeThreshold: c.closeThreshold,
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

        if (!inSpeech) {
          if (rms >= c.openThreshold) {
            speechRun += 1;
            if (speechRun >= c.hangoverFrames) {
              inSpeech = true;
              seenSpeech = true;
              silentRun = 0;
              speechFrames += speechRun;
            }
          } else {
            speechRun = 0;
          }
        } else {
          if (rms >= c.closeThreshold) {
            speechFrames += 1;
            silentRun = 0;
          } else {
            silentRun += 1;
            if (
              speechFrames >= minSpeechFrames &&
              silentRun >= silenceFrames
            ) {
              void finish("silence");
              return;
            }
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

    const timer = setTimeout(() => void finish("max_duration"), c.maxMs + 500);
    if (timer.unref) timer.unref();
    child.on("close", () => {
      clearTimeout(timer);
      if (!done) void finish("stream_end");
    });
  });
}

/**
 * Doctor-style probe (no mic required for structure).
 */
export function probeVad(cfg = {}) {
  const c = vadConfig(cfg);
  return {
    ok: true,
    engine: "energy-rms-hysteresis",
    frameMs: c.frameMs,
    openThreshold: c.openThreshold,
    closeThreshold: c.closeThreshold,
    silenceMs: c.silenceMs,
    maxMs: c.maxMs,
    prerollMs: c.prerollMs,
    hangoverFrames: c.hangoverFrames,
    enabled: c.enabled,
  };
}

export default {
  pcmRms,
  pcmToWav,
  vadConfig,
  analyzePcmFrames,
  recordUntilEndpoint,
  probeVad,
};
