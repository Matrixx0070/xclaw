/**
 * Stream LLM tokens → sentence-flush TTS (lower TTFA for voice).
 * Tool-heavy goals should still use runJob; this path is speak-first Q&A.
 */

import { createSentenceStreamSpeaker } from "./sentence-tts.mjs";

function resolveStreamProvider(cfg = {}) {
  const xai = process.env.XAI_API_KEY;
  const oai = process.env.OPENAI_API_KEY || process.env.XCLAW_API_KEY;
  if (xai) {
    return {
      apiKey: xai,
      baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
      model:
        cfg.agent?.model ||
        process.env.XCLAW_MODEL ||
        "grok-4-1-fast-non-reasoning",
    };
  }
  if (oai) {
    return {
      apiKey: oai,
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: cfg.agent?.model || process.env.XCLAW_MODEL || "gpt-4o-mini",
    };
  }
  return null;
}

/**
 * Stream a short spoken answer; flushes TTS on sentence boundaries mid-stream.
 * @returns {Promise<{ ok: boolean, text: string, firstAudioMs?: number, streamed?: boolean, error?: string }>}
 */
export async function streamSpeakReply(userText, cfg = {}, opts = {}) {
  const creds = resolveStreamProvider(cfg);
  if (!creds) {
    return { ok: false, text: "", error: "no_api_key", streamed: false };
  }

  const speech = opts.speech;
  const speaker = createSentenceStreamSpeaker(cfg, {
    speech,
    maxChars: opts.maxChars || 400,
  });

  let full = "";
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let firstAudioMs = null;

  try {
    const { createProvider } = await import("../agent/provider.mjs");
    const provider = createProvider({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      model: creds.model,
      cfg,
    });

    if (typeof provider.chatStream !== "function") {
      return { ok: false, text: "", error: "no_chatStream", streamed: false };
    }

    await provider.chatStream({
      messages: [
        {
          role: "system",
          content:
            opts.system ||
            "You are XClaw speaking aloud. Reply in 1–3 short sentences. No markdown, no bullet lists, no tool calls.",
        },
        { role: "user", content: String(userText || "").slice(0, 2000) },
      ],
      model: creds.model,
      temperature: 0.4,
      signal: opts.signal,
      onDelta: ({ content }) => {
        if (!content) return;
        full += content;
        speaker.push(content);
        if (firstAudioMs == null && /[.!?]/.test(full)) {
          firstAudioMs =
            (typeof performance !== "undefined" ? performance.now() : Date.now()) -
            t0;
        }
      },
    });

    await speaker.end();
    return {
      ok: true,
      text: full.trim(),
      streamed: true,
      firstAudioMs,
      model: creds.model,
    };
  } catch (e) {
    try {
      await speaker.end();
    } catch {
      /* */
    }
    return {
      ok: false,
      text: full.trim(),
      streamed: true,
      error: e?.message || String(e),
      firstAudioMs,
    };
  }
}

/**
 * Prefer stream for short conversational agent turns; tools → false.
 */
export function shouldStreamVoiceReply(text, routeMode) {
  if (routeMode === "casual" || routeMode === "command") return false;
  const t = String(text || "");
  // Tool-ish → full job
  if (
    /\b(run|execute|install|git|commit|deploy|write file|create file|browse|search the web|swarm)\b/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

export default { streamSpeakReply, shouldStreamVoiceReply };
