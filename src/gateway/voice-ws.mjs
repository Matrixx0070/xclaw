/**
 * Gateway voice session WebSocket — /ws/voice
 *
 * Client messages (JSON text):
 *   { type: "ping" }
 *   { type: "utterance", text: "..." }
 *   { type: "wake", phrase?, text? }
 *   { type: "command", text: "..." }
 *   { type: "barge_in" }
 *   { type: "pcm_start", sampleRate?: 16000, channels?: 1 }
 *   { type: "pcm_end" }   // finalize PCM buffer → STT → agent
 *   { type: "opus_start", sampleRate?: 16000, channels?: 1, container?: "packets"|"ogg" }
 *   { type: "opus_end" }
 *
 * Client binary frames:
 *   after pcm_start: raw S16_LE mono PCM
 *   after opus_start: Opus packets (default) or Ogg/Opus bytes (container=ogg)
 *
 * Server messages:
 *   { type: "ready", sessionId }
 *   { type: "pong" }
 *   { type: "event", ... }
 *   { type: "reply", text, command? }
 *   { type: "error", error }
 */

import crypto from "node:crypto";
import { encodeTextFrame, encodeBinaryFrame, createFrameParser } from "./ws-hub.mjs";
import { createEntente } from "../voice/entente.mjs";
import { localSpeak } from "../voice/providers/local.mjs";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(secKey) {
  return crypto.createHash("sha1").update(secKey + GUID).digest("base64");
}

function sendJson(socket, obj) {
  if (!socket || socket.destroyed) return;
  try {
    socket.write(encodeTextFrame(JSON.stringify(obj)));
  } catch {
    /* */
  }
}

/**
 * @param {import('node:http').Server} server
 * @param {{ cfg?: object, path?: string, auth?: { check: Function } }} opts
 */
export function attachVoiceWebSocket(server, opts = {}) {
  const path = opts.path || "/ws/voice";
  const cfg = opts.cfg || {};
  const sessions = new Map();

  server.on("upgrade", (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== path) return; // other handlers may claim

    if (opts.auth?.isProtectedPath?.(path) && opts.auth?.check) {
      const auth = opts.auth.check(req);
      if (!auth.ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    const key = req.headers["sec-websocket-key"];
    if (!key || String(req.headers.upgrade || "").toLowerCase() !== "websocket") {
      socket.destroy();
      return;
    }

    const ack = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      "",
      "",
    ].join("\r\n");
    socket.write(ack);
    if (head?.length) socket.unshift(head);

    const sessionId = crypto.randomUUID();
    const entente = createEntente();
    const parser = createFrameParser();
    const state = {
      sessionId,
      entente,
      socket,
      busy: false,
      pcm: null, // { sampleRate, channels, chunks: Buffer[], bytes }
      opus: null, // { sampleRate, channels, container, packets: Buffer[], bytes }
      preferOpusReply: false,
    };
    sessions.set(sessionId, state);

    sendJson(socket, {
      type: "ready",
      sessionId,
      path,
      pcm: { codec: "s16le", sampleRate: 16000, channels: 1 },
      opus: { codecs: ["opus"], containers: ["packets", "ogg"], sampleRate: 16000 },
      opusReply: true,
      at: new Date().toISOString(),
    });

    socket.on("data", (chunk) => {
      const { messages, error } = parser.push(chunk);
      if (error) {
        sendJson(socket, { type: "error", error: error.reason });
        socket.destroy();
        return;
      }
      for (const msg of messages) {
        if (msg.type === "binary") {
          if (state.opus) handleOpusBinary(state, msg.data);
          else handlePcmBinary(state, msg.data, cfg);
          continue;
        }
        if (msg.type !== "text") continue;
        let body;
        try {
          body = JSON.parse(msg.data);
        } catch {
          sendJson(socket, { type: "error", error: "invalid_json" });
          continue;
        }
        void handleClientMessage(state, body, cfg);
      }
    });

    socket.on("close", () => sessions.delete(sessionId));
    socket.on("error", () => sessions.delete(sessionId));
  });

  return {
    path,
    sessions,
    clientCount: () => sessions.size,
  };
}

/**
 * Speak text, optionally encode TTS WAV→Opus and push binary packets after reply JSON.
 */
async function sendReplyWithOptionalOpus(state, cfg, payload) {
  const { socket } = state;
  const text = payload.text || "";
  let tts = payload.tts || null;
  let opusReply = null;

  if (payload.speak !== false && text && !tts) {
    tts = await localSpeak(String(text).slice(0, 400), cfg);
  }

  if (
    state.preferOpusReply &&
    tts?.ok &&
    tts.path
  ) {
    try {
      const fs = await import("node:fs/promises");
      const { wavToPcm, encodePcmToOpusPackets } = await import(
        "../voice/opus-encode.mjs"
      );
      const wav = await fs.readFile(tts.path);
      const pcm = wavToPcm(wav);
      const enc = await encodePcmToOpusPackets(pcm, { sampleRate: 16000 });
      if (enc.ok && enc.packets?.length) {
        opusReply = {
          ok: true,
          provider: enc.provider,
          packets: enc.packets.length,
          frameMs: enc.frameMs || 20,
        };
        sendJson(socket, {
          type: "reply",
          ...payload,
          text,
          tts: tts?.ok ? { path: tts.path, provider: tts.provider } : null,
          opus: opusReply,
        });
        sendJson(socket, {
          type: "event",
          event: "opus_reply_start",
          packets: enc.packets.length,
        });
        for (const pkt of enc.packets) {
          try {
            socket.write(encodeBinaryFrame(pkt));
          } catch {
            break;
          }
        }
        sendJson(socket, { type: "event", event: "opus_reply_end" });
        return;
      }
    } catch {
      /* fall through to plain reply */
    }
  }

  sendJson(socket, {
    type: "reply",
    ...payload,
    text,
    tts: tts?.ok ? { path: tts.path, provider: tts.provider } : null,
    opus: null,
  });
}

async function handleClientMessage(state, body, cfg) {
  const { socket, entente, sessionId } = state;
  const type = body?.type;

  if (type === "ping") {
    sendJson(socket, { type: "pong", t: Date.now() });
    return;
  }

  if (type === "barge_in") {
    const r = entente.onBargeIn({ source: "ws" });
    sendJson(socket, { type: "event", event: "barge_in", ...r });
    return;
  }

  if (type === "wake") {
    sendJson(socket, {
      type: "event",
      event: "wake_ack",
      phrase: body.phrase || null,
      text: body.text || null,
    });
    return;
  }

  if (type === "command" || type === "utterance") {
    if (state.busy) {
      sendJson(socket, { type: "error", error: "busy" });
      return;
    }
    const text = String(body.text || "").trim();
    if (!text) {
      sendJson(socket, { type: "error", error: "empty_text" });
      return;
    }

    state.busy = true;
    try {
      const classified = entente.onUserText(text);
      if (
        classified.intent?.kind &&
        classified.intent.kind !== "utterance" &&
        classified.intent.kind !== "none"
      ) {
        const reply = classified.reply || classified.intent.kind;
        entente.setLastSpoken(reply);
        await sendReplyWithOptionalOpus(state, cfg, {
          command: true,
          intent: classified.intent.kind,
          text: reply,
          speak: body.speak,
          sessionId,
        });
        return;
      }

      // Agent path
      let reply = "";
      try {
        const { runJob } = await import("../jobs/job.mjs");
        const job = await runJob({
          goal: text,
          cfg,
          maxTurns: body.maxTurns || 8,
          timeoutMs: body.timeoutMs || 120_000,
          autoApprove: cfg.security?.autoApprove ?? true,
        });
        reply = String(job.text || job.error || "").slice(0, 2000);
      } catch (e) {
        reply = `Error: ${e.message || e}`;
      }
      entente.setLastSpoken(reply);
      await sendReplyWithOptionalOpus(state, cfg, {
        command: false,
        text: reply,
        speak: body.speak,
        sessionId,
      });
    } finally {
      state.busy = false;
    }
    return;
  }

  sendJson(socket, { type: "error", error: `unknown_type:${type}` });
}

export default { attachVoiceWebSocket };
