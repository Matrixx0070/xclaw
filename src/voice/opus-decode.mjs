/**
 * O1 — Decode Opus to PCM/WAV for gateway /ws/voice.
 *
 * Tries (in order):
 *  1) opusscript (optional npm)
 *  2) @discordjs/opus (optional native)
 *  3) ffmpeg (Ogg/Opus file → WAV)
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pcmToWav } from "./vad.mjs";

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (e) =>
      resolve({ code: 1, stdout, stderr: e.message })
    );
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr })
    );
  });
}

/**
 * Probe available Opus decode backends.
 */
export async function probeOpusDecode() {
  const out = {
    opusscript: { ok: false },
    discordjsOpus: { ok: false },
    ffmpeg: { ok: false },
  };
  try {
    await import("opusscript");
    out.opusscript = { ok: true };
  } catch (e) {
    out.opusscript = { ok: false, error: e.message };
  }
  try {
    await import("@discordjs/opus");
    out.discordjsOpus = { ok: true };
  } catch (e) {
    out.discordjsOpus = { ok: false, error: e.message };
  }
  const ff = await run("ffmpeg", ["-version"]);
  out.ffmpeg =
    ff.code === 0
      ? { ok: true }
      : { ok: false, error: "ffmpeg not found" };
  out.ready = out.opusscript.ok || out.discordjsOpus.ok || out.ffmpeg.ok;
  return out;
}

/**
 * Decode concatenated Opus packets (20ms @ 16k) via opusscript / discordjs.
 * @param {Buffer[]} packets
 * @param {{ sampleRate?: number, channels?: number }} [opts]
 */
export async function decodeOpusPacketsToWav(packets, opts = {}) {
  const sampleRate = opts.sampleRate || 16000;
  const channels = opts.channels || 1;
  const pcmChunks = [];

  // opusscript
  try {
    const mod = await import("opusscript");
    const OpusScript = mod.default || mod;
    const encoder = new OpusScript(sampleRate, channels, OpusScript.Application?.VOIP ?? 2048);
    for (const pkt of packets) {
      if (!pkt?.length) continue;
      const pcm = encoder.decode(pkt);
      if (pcm) pcmChunks.push(Buffer.from(pcm));
    }
    if (pcmChunks.length) {
      return {
        ok: true,
        provider: "opusscript",
        wav: pcmToWav(Buffer.concat(pcmChunks), sampleRate),
      };
    }
  } catch {
    /* try next */
  }

  // @discordjs/opus
  try {
    const mod = await import("@discordjs/opus");
    const { OpusEncoder } = mod;
    const dec = new OpusEncoder(sampleRate, channels);
    for (const pkt of packets) {
      if (!pkt?.length) continue;
      const pcm = dec.decode(pkt);
      if (pcm) pcmChunks.push(Buffer.from(pcm));
    }
    if (pcmChunks.length) {
      return {
        ok: true,
        provider: "@discordjs/opus",
        wav: pcmToWav(Buffer.concat(pcmChunks), sampleRate),
      };
    }
  } catch {
    /* try next */
  }

  return {
    ok: false,
    error:
      "no Opus packet decoder (install opusscript or @discordjs/opus, or send container=ogg)",
  };
}

/**
 * Decode Ogg/Opus container bytes via ffmpeg → WAV file buffer.
 * @param {Buffer} oggBytes
 */
export async function decodeOggOpusToWav(oggBytes, opts = {}) {
  const sampleRate = opts.sampleRate || 16000;
  const dir = os.tmpdir();
  const inPath = path.join(dir, `xclaw-opus-in-${Date.now()}.ogg`);
  const outPath = path.join(dir, `xclaw-opus-out-${Date.now()}.wav`);
  try {
    await fs.writeFile(inPath, oggBytes);
    const r = await run("ffmpeg", [
      "-y",
      "-i",
      inPath,
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "wav",
      outPath,
    ]);
    if (r.code !== 0) {
      return {
        ok: false,
        error: r.stderr?.slice(0, 300) || "ffmpeg decode failed",
        provider: "ffmpeg",
      };
    }
    const wav = await fs.readFile(outPath);
    return { ok: true, provider: "ffmpeg", wav, path: outPath };
  } catch (e) {
    return { ok: false, error: e.message || String(e), provider: "ffmpeg" };
  } finally {
    try {
      await fs.unlink(inPath);
    } catch {
      /* */
    }
  }
}

/**
 * Unified entry: mode packets | ogg
 */
export async function decodeOpusToWav(input, opts = {}) {
  const mode = opts.mode || opts.container || "packets";
  if (mode === "ogg" || mode === "ogg/opus") {
    const buf = Buffer.isBuffer(input)
      ? input
      : Buffer.concat(Array.isArray(input) ? input : []);
    return decodeOggOpusToWav(buf, opts);
  }
  const packets = Array.isArray(input) ? input : [input];
  const pkt = await decodeOpusPacketsToWav(packets, opts);
  if (pkt.ok) return pkt;
  // Last resort: treat concat as ogg file
  const asOgg = await decodeOggOpusToWav(Buffer.concat(packets.map((p) => Buffer.from(p))), opts);
  if (asOgg.ok) return asOgg;
  return pkt;
}

export default {
  probeOpusDecode,
  decodeOpusPacketsToWav,
  decodeOggOpusToWav,
  decodeOpusToWav,
};
