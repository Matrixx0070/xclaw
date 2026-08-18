/**
 * W0 — Wake word probe / light edge detector.
 *
 * Paths:
 *  1) energy-gate + short STT + keyword match (works with arecord + whisper)
 *  2) optional openWakeWord if Python module available
 *
 * Does NOT start the full agent — only reports wake hits for wiring in W1.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { localTranscribe } from "../providers/local.mjs";

export const DEFAULT_WAKE_PHRASES = [
  "hey xclaw",
  "okay xclaw",
  "hi xclaw",
  "xclaw",
];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: opts.input != null ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env || {}) },
    });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      resolve({ code: 1, stdout, stderr: err.message })
    );
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr })
    );
    if (opts.input != null) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

export function wakeConfig(cfg = {}) {
  const w = cfg.voice?.wake || cfg.wake || {};
  return {
    phrases: (w.phrases || DEFAULT_WAKE_PHRASES).map((p) =>
      String(p).toLowerCase().trim()
    ),
    energyThreshold: Number(w.energyThreshold) > 0 ? Number(w.energyThreshold) : 500,
    recordSeconds: Number(w.recordSeconds) > 0 ? Number(w.recordSeconds) : 2,
    commandSeconds: Number(w.commandSeconds) > 0 ? Number(w.commandSeconds) : 4,
    sampleRate: Number(w.sampleRate) > 0 ? Number(w.sampleRate) : 16000,
    enabled: w.enabled !== false,
  };
}

/**
 * Normalize transcript and test against wake phrases.
 */
export function matchWakePhrase(transcript, phrases = DEFAULT_WAKE_PHRASES) {
  const t = String(transcript || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return { hit: false, phrase: null, transcript: t };
  for (const p of phrases) {
    if (!p) continue;
    if (t === p || t.includes(p) || p.split(" ").every((w) => t.includes(w))) {
      return { hit: true, phrase: p, transcript: t };
    }
  }
  // fuzzy: "hey claw" / "a claw"
  if (/\b(hey|ok|okay|hi|yo)\s+(x?\s*)?claw\b/.test(t) || /\bxclaw\b/.test(t)) {
    return { hit: true, phrase: "fuzzy-xclaw", transcript: t };
  }
  return { hit: false, phrase: null, transcript: t };
}

/**
 * RMS energy of a 16-bit LE mono wav (skip 44-byte header if present).
 */
export function wavRmsEnergy(buf) {
  if (!buf || buf.length < 100) return 0;
  let offset = 0;
  if (buf.toString("utf8", 0, 4) === "RIFF") offset = 44;
  const samples = Math.floor((buf.length - offset) / 2);
  if (samples <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const s = buf.readInt16LE(offset + i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

/**
 * Record a short clip via arecord (ALSA).
 */
export async function recordClip(opts = {}) {
  const seconds = opts.seconds ?? 2;
  const rate = opts.sampleRate ?? 16000;
  const out =
    opts.path ||
    path.join(os.tmpdir(), `xclaw-wake-${Date.now()}.wav`);
  const r = await run("arecord", [
    "-d",
    String(seconds),
    "-f",
    "S16_LE",
    "-r",
    String(rate),
    "-c",
    "1",
    out,
  ]);
  if (r.code !== 0) {
    return {
      ok: false,
      error: r.stderr || "arecord failed (install alsa-utils)",
      path: null,
    };
  }
  try {
    await fs.access(out);
    return { ok: true, path: out };
  } catch {
    return { ok: false, error: "record produced no file", path: null };
  }
}

/**
 * One-shot energy gate: record → RMS → optional STT → phrase match.
 */
export async function probeWakeOnce(cfg = {}, opts = {}) {
  const c = wakeConfig(cfg);
  const rec = await recordClip({
    seconds: opts.seconds ?? c.recordSeconds,
    sampleRate: c.sampleRate,
  });
  if (!rec.ok) {
    return {
      ok: false,
      stage: "record",
      error: rec.error,
      hit: false,
    };
  }

  let energy = 0;
  try {
    const buf = await fs.readFile(rec.path);
    energy = wavRmsEnergy(buf);
  } catch (e) {
    return { ok: false, stage: "energy", error: e.message, hit: false };
  }

  const above = energy >= (opts.energyThreshold ?? c.energyThreshold);
  const result = {
    ok: true,
    stage: above ? "stt" : "energy",
    path: rec.path,
    energy: Math.round(energy),
    energyThreshold: c.energyThreshold,
    aboveThreshold: above,
    hit: false,
    phrase: null,
    transcript: null,
  };

  if (!above && !opts.forceStt) {
    result.reason = "below_energy_threshold";
    return result;
  }

  const tr = await localTranscribe(rec.path, cfg);
  result.transcript = tr.text || "";
  result.sttOk = tr.ok;
  result.sttProvider = tr.provider;
  if (!tr.ok) {
    result.stage = "stt";
    result.error = tr.error;
    return result;
  }

  const match = matchWakePhrase(tr.text, c.phrases);
  result.hit = match.hit;
  result.phrase = match.phrase;
  result.transcript = match.transcript;
  result.stage = "match";
  return result;
}

/**
 * Doctor / CLI probe of wake prerequisites (no mic loop).
 */
export async function probeWakeStack(cfg = {}) {
  const c = wakeConfig(cfg);
  const out = {
    enabled: c.enabled,
    phrases: c.phrases,
    energyThreshold: c.energyThreshold,
    arecord: { ok: false },
    openWakeWord: { ok: false },
    stt: { ok: false },
  };

  const ar = await run("arecord", ["--version"]);
  out.arecord =
    ar.code === 0 || /arecord/i.test(ar.stderr + ar.stdout.toString())
      ? { ok: true }
      : { ok: false, error: "arecord not found (alsa-utils)" };

  // Optional: python -c "import openwakeword"
  const py = await run("python3", [
    "-c",
    "import openwakeword; print('ok')",
  ]);
  out.openWakeWord =
    py.code === 0 && /ok/.test(py.stdout.toString())
      ? { ok: true, note: "Python package available" }
      : {
          ok: false,
          error: "openwakeword not installed (optional for W1+)",
        };

  // STT availability: probe the whisper CLI directly. Never call
  // probeLocalVoiceStack from here — it calls probeWakeStack back and the
  // mutual recursion never terminates (hung doctor + wake tests).
  try {
    const whisperBin =
      cfg?.voice?.local?.whisperBin || process.env.XCLAW_WHISPER_BIN || "whisper-cli";
    const wh = await run(whisperBin, ["--help"]);
    out.stt =
      wh.code === 0 || /whisper/i.test(wh.stderr + wh.stdout.toString())
        ? { ok: true, bin: whisperBin }
        : { ok: false, error: "no whisper CLI" };
  } catch (e) {
    out.stt = { ok: false, error: e.message };
  }

  out.readyForW1 =
    out.arecord.ok && (out.stt.ok || out.openWakeWord.ok);

  return out;
}

/**
 * Optional openWakeWord single-frame helper (Python one-liner stub).
 * Real streaming loop is W1.
 */
export async function probeOpenWakeWordOnce() {
  const script = `
try:
  import openwakeword
  from openwakeword.model import Model
  print("OPENWAKEWORD_OK")
except Exception as e:
  print("OPENWAKEWORD_ERR", e)
`;
  const r = await run("python3", ["-c", script]);
  const text = r.stdout.toString() + r.stderr;
  if (/OPENWAKEWORD_OK/.test(text)) {
    return { ok: true, provider: "openwakeword" };
  }
  return { ok: false, error: text.trim() || "import failed" };
}

export default {
  DEFAULT_WAKE_PHRASES,
  wakeConfig,
  matchWakePhrase,
  wavRmsEnergy,
  recordClip,
  probeWakeOnce,
  probeWakeStack,
  probeOpenWakeWordOnce,
};
