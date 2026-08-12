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
  // Optional simple tool hint: ```tool name\n{json}```
  const toolCalls = [];
  const toolRe =
    /```tool\s+(\S+)\s*\n([\s\S]*?)```/gi;
  let m;
  while ((m = toolRe.exec(text))) {
    try {
      toolCalls.push({
        name: m[1],
        arguments: JSON.parse(m[2]),
      });
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
  const tmp = path.join(
    os.tmpdir(),
    `xclaw-tts-${Date.now()}.wav`
  );
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

  // espeak-ng → wav
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
    error:
      "No local TTS. Install: espeak-ng, or piper + XCLAW_PIPER_MODEL",
    provider: "none",
  };
}

/**
 * STT via whisper CLI if present. audioPath = wav/flac.
 */
export async function localTranscribe(audioPath, cfg = {}) {
  const c = localConfig(cfg);
  const r = await run(c.whisperBin, [
    "-m",
    c.whisperModel,
    "-f",
    audioPath,
    "-nt",
  ]);
  if (r.code !== 0) {
    return {
      ok: false,
      text: "",
      error:
        r.stderr ||
        "whisper CLI failed — install whisper.cpp or faster-whisper",
    };
  }
  const text = r.stdout.toString("utf8").trim();
  return { ok: true, text, provider: "whisper-local" };
}

/**
 * Doctor-style probe of local stack.
 */
export async function probeLocalVoiceStack(cfg = {}) {
  const c = localConfig(cfg);
  const out = {
    ollama: { ok: false },
    tts: { ok: false },
    stt: { ok: false },
  };

  try {
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
  out.stt =
    wh.code === 0 || /whisper/i.test(wh.stderr + wh.stdout.toString())
      ? { ok: true, bin: c.whisperBin }
      : { ok: false, error: "whisper CLI not found (optional for file STT)" };

  return out;
}
