/**
 * Gateway local-voice HTTP routes (extracted from gateway/index.mjs, W2).
 *
 * Paths:
 *   GET  /api/voice/probe      — local STT/TTS/LLM stack probe
 *   GET  /api/voice/metrics    — voice metrics snapshot
 *   POST /api/voice/speak      — local TTS {text} → wav path
 *   POST /api/voice/transcribe — local STT {path | audioBase64,mime}
 */

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleVoiceRoute({ p, method, req, res, cfg, json, readBody }) {
  if (p === "/api/voice/probe" && method === "GET") {
    const { probeLocalVoiceStack } = await import("../../voice/providers/local.mjs");
    json(res, 200, await probeLocalVoiceStack(cfg));
    return true;
  }
  if (p === "/api/voice/metrics" && method === "GET") {
    const { voiceMetricsSnapshot } = await import("../../voice/metrics.mjs");
    json(res, 200, voiceMetricsSnapshot());
    return true;
  }
  if (p === "/api/voice/speak" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { localSpeak } = await import("../../voice/providers/local.mjs");
    const text = String(body.text || body.message || "").slice(0, 500);
    const out = await localSpeak(text, cfg);
    // Return path only (local); WebUI can fetch file if shared
    json(res, out.ok ? 200 : 503, out);
    return true;
  }
  if (p === "/api/voice/transcribe" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { localTranscribe } = await import("../../voice/providers/local.mjs");
    // Browsers hold audio bytes, not server paths — accept an upload so the
    // WebChat mic can use the local STT instead of a cloud speech API.
    const audioB64 = body.audioBase64 || body.audio || null;
    if (audioB64) {
      const fsp = await import("node:fs/promises");
      const os = await import("node:os");
      const nodePath = await import("node:path");
      const ext = /webm/i.test(body.mime || "")
        ? "webm"
        : /ogg|opus/i.test(body.mime || "")
          ? "ogg"
          : /mp4|m4a|aac/i.test(body.mime || "")
            ? "m4a"
            : "wav";
      const tmp = nodePath.join(
        os.tmpdir(),
        `xclaw-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      );
      try {
        await fsp.writeFile(tmp, Buffer.from(String(audioB64), "base64"));
        const out = await localTranscribe(tmp, cfg);
        json(res, out.ok ? 200 : 503, out);
      } finally {
        await fsp.unlink(tmp).catch(() => {});
      }
      return true;
    }
    const file = body.path || body.file || body.audioPath;
    if (!file) {
      json(res, 400, { error: "path or audioBase64 required" });
      return true;
    }
    const out = await localTranscribe(file, cfg);
    json(res, out.ok ? 200 : 503, out);
    return true;
  }
  return false;
}

export default { tryHandleVoiceRoute };
