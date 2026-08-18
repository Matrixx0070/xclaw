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
import { localTranscribe, localConfig, looksLikeWhisperCli } from "../providers/local.mjs";
import {
  probeCapture,
  captureReadyForWake,
} from "../capture-probe.mjs";

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
      resolve({
        code: err.code === "ENOENT" ? 127 : 1,
        stdout,
        stderr: err.message || String(err),
        errorCode: err.code || null,
      })
    );
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr, errorCode: null })
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
  if (/\b(hey|ok|okay|hi|yo)\s+(x?\s*)?claw\b/.test(t) || /\bxclaw\b/.test(t)) {
    return { hit: true, phrase: "fuzzy-xclaw", transcript: t };
  }
  return { hit: false, phrase: null, transcript: t };
}

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

export async function recordClip(opts = {}) {
  const seconds = opts.seconds ?? 2;
  const rate = opts.sampleRate ?? 16000;
  const out =
    opts.path ||
    path.join(os.tmpdir(), `xclaw-wake-${Date.now()}.wav`);

  let device =
    opts.device ||
    opts.target ||
    process.env.XCLAW_CAPTURE_TARGET ||
    null;

  let backend = (
    opts.backend ||
    process.env.XCLAW_CAPTURE_BACKEND ||
    ""
  )
    .toString()
    .toLowerCase()
    .trim();

  let probe = opts.probe || null;
  if (!backend && opts.autoProbe !== false) {
    try {
      probe =
        probe ||
        (await probeCapture({
          target: device || process.env.PIPEWIRE_NODE || null,
        }));
      if (probe?.monitorRejected && !device) {
        return {
          ok: false,
          error:
            probe.errors?.join("; ") ||
            "default capture source looks like a sink monitor",
          path: null,
          device: null,
          tool: null,
          backend: probe.backend || null,
          probe,
        };
      }
      if (!backend && probe?.backend) {
        backend = String(probe.backend).toLowerCase();
      }
      if (!device && probe?.target) {
        device = probe.target;
      }
      if (
        !device &&
        probe?.backend === "pulse" &&
        probe?.pulse?.defaultSource?.name
      ) {
        device = probe.pulse.defaultSource.name;
      }
    } catch {
      /* keep backend empty → alsa path */
    }
  }

  const wantPulse =
    backend === "pulse" ||
    opts.usePulse === true ||
    device === "pulse" ||
    device === "@DEFAULT_SOURCE@";

  const env = { ...process.env };
  if (backend === "wireplumber" || backend === "pipewire-alsa") {
    if (device && !env.PIPEWIRE_NODE) env.PIPEWIRE_NODE = String(device);
  } else if (opts.target && !device) {
    env.PIPEWIRE_NODE = String(opts.target);
  } else if (process.env.PIPEWIRE_NODE) {
    env.PIPEWIRE_NODE = process.env.PIPEWIRE_NODE;
  }

  const finishOk = async (tool, usedDevice) => {
    const b =
      tool === "parecord" || usedDevice === "pulse"
        ? "pulse"
        : backend || "alsa";
    try {
      await fs.access(out);
      return {
        ok: true,
        path: out,
        device: usedDevice || null,
        tool,
        backend: b,
        probe: probe || undefined,
      };
    } catch {
      return {
        ok: false,
        error: "record produced no file",
        path: null,
        tool,
        backend: b,
        probe: probe || undefined,
      };
    }
  };

  if (wantPulse || backend === "pulse") {
    const pulseDev = device && device !== "pulse" ? device : "@DEFAULT_SOURCE@";
    const pr = await run(
      "timeout",
      [
        String(Math.max(1, Number(seconds) + 1)),
        "parecord",
        "-d",
        pulseDev,
        `--rate=${rate}`,
        "--channels=1",
        "--format=s16le",
        out,
      ],
      { env }
    );
    if (
      (pr.code === 0 || pr.code === 124) &&
      !(pr.errorCode === "ENOENT" || pr.code === 127)
    ) {
      const ok = await finishOk("parecord", pulseDev);
      if (ok.ok) return ok;
    }
    const arPulse = await run(
      "arecord",
      [
        "-d",
        String(seconds),
        "-f",
        "S16_LE",
        "-r",
        String(rate),
        "-c",
        "1",
        "-D",
        "pulse",
        out,
      ],
      { env }
    );
    if (arPulse.code === 0) {
      return finishOk("arecord", "pulse");
    }
    if (wantPulse && backend === "pulse") {
      return {
        ok: false,
        error:
          pr.stderr ||
          arPulse.stderr ||
          "parecord/arecord -D pulse failed (install pulseaudio-utils)",
        path: null,
        device: pulseDev,
        tool: "parecord",
        backend: "pulse",
        probe: probe || undefined,
      };
    }
  }

  const args = [
    "-d",
    String(seconds),
    "-f",
    "S16_LE",
    "-r",
    String(rate),
    "-c",
    "1",
  ];
  if (device && device !== "pulse" && device !== "@DEFAULT_SOURCE@") {
    args.push("-D", String(device));
  }
  args.push(out);
  const r = await run("arecord", args, { env });
  if (r.code !== 0) {
    return {
      ok: false,
      error: r.stderr || "arecord failed (install alsa-utils)",
      path: null,
      device: device || null,
      tool: "arecord",
      backend: backend || "alsa",
      probe: probe || undefined,
    };
  }
  return finishOk("arecord", device);
}

export async function probeWakeOnce(cfg = {}, opts = {}) {
  const c = wakeConfig(cfg);
  const rec = await recordClip({
    seconds: opts.seconds ?? c.recordSeconds,
    sampleRate: c.sampleRate,
    backend:
      opts.backend ||
      cfg.voice?.captureBackend ||
      process.env.XCLAW_CAPTURE_BACKEND ||
      null,
    device:
      opts.device ||
      opts.target ||
      cfg.voice?.captureTarget ||
      process.env.XCLAW_CAPTURE_TARGET ||
      null,
    target: opts.target || cfg.voice?.captureTarget || null,
  });
  if (!rec.ok) {
    return {
      ok: false,
      stage: "record",
      error: rec.error,
      hit: false,
      tool: rec.tool || null,
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

export async function probeWakeStack(cfg = {}) {
  const c = wakeConfig(cfg);
  const out = {
    enabled: c.enabled,
    phrases: c.phrases,
    energyThreshold: c.energyThreshold,
    arecord: { ok: false },
    capture: null,
    openWakeWord: { ok: false },
    stt: { ok: false },
  };

  try {
    out.capture = await probeCapture({
      target:
        cfg.voice?.captureTarget ||
        cfg.captureTarget ||
        process.env.XCLAW_CAPTURE_TARGET ||
        process.env.PIPEWIRE_NODE ||
        null,
    });
    out.arecord = {
      ok: Boolean(out.capture?.arecord?.ok) || Boolean(out.capture?.ok),
      cards: out.capture?.arecord?.cards || [],
      backend: out.capture?.backend || null,
      error: out.capture?.arecord?.error,
      monitorRejected: Boolean(out.capture?.monitorRejected),
    };
  } catch (e) {
    out.capture = { ok: false, error: e.message };
    const ar = await run("arecord", ["--version"]);
    const arMissing = ar.errorCode === "ENOENT" || ar.code === 127;
    out.arecord = arMissing
      ? { ok: false, error: "arecord not found (alsa-utils)" }
      : { ok: true, note: "capture probe failed; binary only" };
  }

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

  try {
    const whisperBin = localConfig(cfg).whisperBin;
    const wh = await run(whisperBin, ["--help"]);
    out.stt = looksLikeWhisperCli(wh)
      ? { ok: true, bin: whisperBin }
      : {
          ok: false,
          error:
            wh.errorCode === "ENOENT" || wh.code === 127
              ? "whisper CLI not found (ENOENT)"
              : "no whisper CLI",
        };
  } catch (e) {
    out.stt = { ok: false, error: e.message };
  }

  const captureOk = captureReadyForWake(out.capture) || out.arecord.ok;
  out.readyForW1 =
    captureOk &&
    !out.capture?.monitorRejected &&
    (out.stt.ok || out.openWakeWord.ok);

  return out;
}

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

export { probeCapture, captureReadyForWake };

export default {
  DEFAULT_WAKE_PHRASES,
  wakeConfig,
  matchWakePhrase,
  wavRmsEnergy,
  recordClip,
  probeWakeOnce,
  probeWakeStack,
  probeOpenWakeWordOnce,
  probeCapture,
  captureReadyForWake,
};
