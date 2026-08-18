/**
 * Local-first voice providers — no paid APIs required.
 *
 * STT:  faster-whisper / whisper.cpp via CLI or HTTP
 * TTS:  piper / kokoro / espeak-ng
 * LLM:  Ollama (or any OpenAI-compatible local server)
 *
 * Env overrides (optional):
 *   XCLAW_OLLAMA_URL=http://127.0.0.1:11434
 *   XCLAW_OLLAMA_MODEL=qwen2.5:7b
 *   XCLAW_WHISPER_BIN=whisper-cli
 *   XCLAW_PIPER_BIN=piper
 *   XCLAW_PIPER_MODEL=/path/to/en_US-lessac-medium.onnx
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { looksLikeWhisperCli } from "./looks-like-whisper.mjs";
export { looksLikeWhisperCli };

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
    // spawnError / errorCode distinguish "binary missing" from "binary ran and failed".
    child.on("error", (err) =>
      resolve({
        code: err.code === "ENOENT" ? 127 : 1,
        stdout,
        stderr: err.message || String(err),
        spawnError: err,
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

export function localConfig(cfg = {}) {
  const v = cfg.voice || {};
  return {
    ollamaUrl:
      v.ollamaUrl ||
      process.env.XCLAW_OLLAMA_URL ||
      "http://127.0.0.1:11434",
    ollamaModel:
      v.ollamaModel ||
      process.env.XCLAW_OLLAMA_MODEL ||
      "qwen2.5:7b",
    whisperBin:
      v.whisperBin || process.env.XCLAW_WHISPER_BIN || "whisper-cli",
    whisperModel:
      v.whisperModel || process.env.XCLAW_WHISPER_MODEL || "base",
    piperBin: v.piperBin || process.env.XCLAW_PIPER_BIN || "piper",
    piperModel:
      v.piperModel ||
      process.env.XCLAW_PIPER_MODEL ||
      "",
    espeakBin: v.espeakBin || process.env.XCLAW_ESPEAK_BIN || "espeak-ng",
  };
}

/**
 * Local LLM chat via Ollama HTTP API (no paid key).
 */
export async function localThink(prompt, ctx = {}, cfg = {}) {
  const c = localConfig(cfg);
  const system =
    ctx.instructions ||
    "You are a helpful local voice assistant. Keep replies short for speech.";
  const messages = [
    { role: "system", content: system },
    ...(ctx.history || [])
      .slice(-10)
      .map((h) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: h.content,
      })),
    { role: "user", content: prompt },
  ];

  const url = `${c.ollamaUrl.replace(/\/$/, "")}/api/chat`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: c.ollamaModel,
        messages,
        stream: false,
        options: { temperature: 0.4, num_predict: 256 },
      }),
    });
  } catch (e) {
    return {
      text: `Local model unavailable (${e.message}). Is Ollama running?`,
      toolCalls: [],
      provider: "ollama",
      error: e.message,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      text: `Ollama error ${res.status}. Pull a model: ollama pull ${c.ollamaModel}`,
      toolCalls: [],
      provider: "ollama",
      error: body.slice(0, 200),
    };
  }

  const data = await res.json();
  const text = data?.message?.content || data?.response || "";
  const toolCalls = [];
  const toolRe = /```tool\s+(\S+)\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = toolRe.exec(text))) {
    try {
      toolCalls.push({ name: m[1], arguments: JSON.parse(m[2]) });
    } catch {
      /* ignore bad json */
    }
  }

  return {
    text: text.replace(toolRe, "").trim() || text.trim(),
    toolCalls,
    provider: "ollama",
    model: c.ollamaModel,
  };
}

/**
 * TTS via piper (preferred) or espeak-ng fallback. Returns wav path or null.
 */
export async function localSpeak(text, cfg = {}) {
  const c = localConfig(cfg);
  const tmp = path.join(os.tmpdir(), `xclaw-tts-${Date.now()}.wav`);
  const t = String(text || "").slice(0, 500);

  if (c.piperModel) {
    const r = await run(
      c.piperBin,
      ["--model", c.piperModel, "--output_file", tmp],
      { input: t }
    );
    if (r.code === 0) {
      try {
        await fs.access(tmp);
        return { ok: true, path: tmp, provider: "piper" };
      } catch {
        /* fall through */
      }
    }
  }

  const r2 = await run(c.espeakBin, ["-w", tmp, t]);
  if (r2.code === 0) {
    try {
      await fs.access(tmp);
      return { ok: true, path: tmp, provider: "espeak-ng" };
    } catch {
      /* */
    }
  }

  return {
    ok: false,
    error: "No local TTS. Install: espeak-ng, or piper + XCLAW_PIPER_MODEL",
    provider: "none",
  };
}

async function ensureWav(audioPath) {
  const lower = String(audioPath || "").toLowerCase();
  if (lower.endsWith(".wav") || lower.endsWith(".flac")) {
    return audioPath;
  }
  const out = path.join(os.tmpdir(), `xclaw-stt-${Date.now()}.wav`);
  const r = await run("ffmpeg", ["-y", "-i", audioPath, "-ar", "16000", "-ac", "1", out]);
  if (r.code !== 0) return null;
  try {
    await fs.access(out);
    return out;
  } catch {
    return null;
  }
}

export async function localTranscribe(audioPath, cfg = {}) {
  const c = localConfig(cfg);
  if (!audioPath) {
    return { ok: false, text: "", error: "audioPath required" };
  }
  let pathIn = audioPath;
  try {
    await fs.access(pathIn);
  } catch {
    return { ok: false, text: "", error: `audio not found: ${audioPath}` };
  }

  const wav = await ensureWav(pathIn);
  if (!wav) {
    return {
      ok: false,
      text: "",
      error: "ffmpeg failed converting audio to wav (needed for ogg/mp3 voice notes)",
    };
  }

  const attempts = [
    {
      bin: c.whisperBin,
      args: ["-m", c.whisperModel, "-f", wav, "-nt"],
      provider: "whisper.cpp",
    },
    {
      bin: "whisper-cpp",
      args: ["-m", c.whisperModel, "-f", wav, "-nt"],
      provider: "whisper-cpp",
    },
    {
      bin: "whisper",
      args: [wav, "--model", c.whisperModel, "--language", "en", "--output_format", "txt"],
      provider: "openai-whisper-cli",
    },
  ];

  for (const a of attempts) {
    const r = await run(a.bin, a.args);
    if (r.code === 0) {
      let text = r.stdout.toString("utf8").trim();
      text = text
        .split("\n")
        .map((line) => line.replace(/^\[[^\]]*\]\s*/, "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (text) {
        return { ok: true, text, provider: a.provider, wav };
      }
    }
  }

  return {
    ok: false,
    text: "",
    error:
      "No working local STT. Install whisper.cpp (whisper-cli) or openai-whisper CLI; ensure ffmpeg for ogg.",
  };
}

/**
 * Doctor-style probe of local stack.
 */
export async function probeLocalVoiceStack(cfg = {}, { skipNetwork = false } = {}) {
  const c = localConfig(cfg);
  const out = {
    ollama: { ok: false },
    tts: { ok: false },
    stt: { ok: false },
  };

  try {
    if (skipNetwork) throw new Error("skipped (hermetic)");
    const r = await fetch(`${c.ollamaUrl.replace(/\/$/, "")}/api/tags`);
    if (r.ok) {
      const j = await r.json();
      const names = (j.models || []).map((m) => m.name);
      out.ollama = {
        ok: true,
        url: c.ollamaUrl,
        model: c.ollamaModel,
        models: names.slice(0, 12),
        hasModel: names.some(
          (n) => n === c.ollamaModel || n.startsWith(c.ollamaModel + ":")
        ),
      };
    } else {
      out.ollama = { ok: false, error: `HTTP ${r.status}` };
    }
  } catch (e) {
    out.ollama = { ok: false, error: e.message };
  }

  const es = await run(c.espeakBin, ["--version"]);
  out.tts =
    es.code === 0
      ? { ok: true, provider: "espeak-ng" }
      : { ok: false, error: "espeak-ng not found; piper optional" };

  if (c.piperModel) {
    out.tts.piperModel = c.piperModel;
  }

  const wh = await run(c.whisperBin, ["--help"]);
  out.stt = looksLikeWhisperCli(wh)
    ? { ok: true, bin: c.whisperBin }
    : {
        ok: false,
        error:
          wh.errorCode === "ENOENT" || wh.code === 127 || wh.spawnError
            ? `whisper CLI not found (${c.whisperBin}); install whisper.cpp or set XCLAW_WHISPER_BIN`
            : "whisper CLI not found (optional for file STT)",
      };

  // Avoid mutual recursion with probeWakeStack.
  if (cfg?.voice?._probeSkipWake !== true) {
    try {
      const { probeWakeStack } = await import("../wake/index.mjs");
      out.wake = await probeWakeStack({
        ...cfg,
        voice: { ...(cfg.voice || {}), _probeSkipWake: true },
      });
    } catch (e) {
      out.wake = { ok: false, error: e.message || String(e) };
    }
  }

  return out;
}
