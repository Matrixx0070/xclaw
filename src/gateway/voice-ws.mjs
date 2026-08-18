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
 *   { type: "webrtc_offer", sdp: "..." }
 *   { type: "webrtc_ice", candidate: {...} }
 *   { type: "webrtc_close" }
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
import { encodeTextFrame, encodeBinaryFrame, createFrameParser, sendClose } from "./ws-hub.mjs";
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
      webrtc: null, // { session from acceptOffer }
    };
    sessions.set(sessionId, state);

    sendJson(socket, {
      type: "ready",
      sessionId,
      path,
      pcm: { codec: "s16le", sampleRate: 16000, channels: 1 },
      opus: { codecs: ["opus"], containers: ["packets", "ogg"], sampleRate: 16000 },
      opusReply: true,
      webrtc: { signaling: true, engine: "werift-optional" },
      at: new Date().toISOString(),
    });

    socket.on("data", (chunk) => {
      let messages, error;
      try {
        ({ messages, error } = parser.push(chunk));
      } catch (e) {
        sendJson(socket, { type: "error", error: `frame: ${e.message || e}` });
        socket.destroy();
        return;
      }
      if (error) {
        sendJson(socket, { type: "error", error: error.reason });
        socket.destroy();
        return;
      }
      for (const msg of messages) {
        if (msg.type === "binary") {
          // A client must never be able to take the gateway down: any fault in
          // audio buffering fails this connection, not the process.
          try {
            const ok = state.opus
              ? handleOpusBinary(state, msg.data)
              : handlePcmBinary(state, msg.data);
            if (!ok) {
              sendJson(socket, { type: "error", error: "audio_too_large" });
              state.pcm = null;
              state.opus = null;
            }
          } catch (e) {
            sendJson(socket, { type: "error", error: `audio: ${e.message || e}` });
            state.pcm = null;
            state.opus = null;
          }
          continue;
        }
        if (msg.type === "close") {
          // Complete the closing handshake. Without this the client's socket
          // stays in CLOSING forever (one-shot edge clients never exit) and
          // this session is only reclaimed when the TCP socket finally dies.
          sendClose(socket, msg.code || 1000, "", { graceMs: 250 });
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
        // Never let a client message reject into an unhandled rejection —
        // that kills the whole gateway process, not just this session.
        handleClientMessage(state, body, cfg).catch((e) => {
          state.busy = false;
          sendJson(socket, { type: "error", error: `handler: ${e?.message || e}` });
        });
      }
    });

    socket.on("close", () => {
      try {
        state.webrtc?.close?.();
      } catch {
        /* */
      }
      sessions.delete(sessionId);
    });
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

/** Hard cap on buffered audio per utterance (~60s of 16kHz mono s16le). */
const MAX_AUDIO_BYTES = 2_000_000;

/** Buffer an incoming raw PCM frame. Returns false when the cap is exceeded. */
function handlePcmBinary(state, data) {
  if (!state.pcm) {
    // Tolerate binary before pcm_start rather than dropping the audio.
    state.pcm = { sampleRate: 16000, channels: 1, chunks: [], bytes: 0 };
  }
  const buf = Buffer.from(data);
  if (state.pcm.bytes + buf.length > MAX_AUDIO_BYTES) return false;
  state.pcm.chunks.push(buf);
  state.pcm.bytes += buf.length;
  return true;
}

/** Buffer an incoming Opus packet (or ogg chunk). */
function handleOpusBinary(state, data) {
  if (!state.opus) {
    state.opus = {
      sampleRate: 16000,
      channels: 1,
      container: "packets",
      packets: [],
      bytes: 0,
    };
  }
  const buf = Buffer.from(data);
  if (state.opus.bytes + buf.length > MAX_AUDIO_BYTES) return false;
  state.opus.packets.push(buf);
  state.opus.bytes += buf.length;
  return true;
}

/**
 * Buffered audio → wav on disk → STT → the same turn path as a text utterance.
 */
async function finalizeAudioTurn(state, cfg, kind, opts = {}) {
  const { socket } = state;
  const fsp = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  let wav = null;
  try {
    if (kind === "pcm") {
      const { pcmToWav } = await import("../voice/vad.mjs");
      const pcm = Buffer.concat(state.pcm?.chunks || []);
      if (!pcm.length) throw new Error("no_audio");
      wav = pcmToWav(pcm, state.pcm.sampleRate || 16000);
    } else {
      const { decodeOpusPacketsToWav, decodeOggOpusToWav } = await import(
        "../voice/opus-decode.mjs"
      );
      const packets = state.opus?.packets || [];
      if (!packets.length) throw new Error("no_audio");
      const dec =
        state.opus.container === "ogg"
          ? await decodeOggOpusToWav(Buffer.concat(packets), {
              sampleRate: state.opus.sampleRate,
            })
          : await decodeOpusPacketsToWav(packets, {
              sampleRate: state.opus.sampleRate,
            });
      if (!dec?.ok) throw new Error(dec?.error || "opus_decode_failed");
      wav = dec.wav || dec.buffer;
    }
  } catch (e) {
    state.pcm = null;
    state.opus = null;
    sendJson(socket, { type: "error", error: `audio_decode: ${e.message || e}` });
    return;
  }

  const tmp = path.join(
    os.tmpdir(),
    `xclaw-voice-in-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`
  );
  let text = "";
  try {
    await fsp.writeFile(tmp, wav);
    const { localTranscribe } = await import("../voice/providers/local.mjs");
    const tr = await localTranscribe(tmp, cfg);
    if (!tr.ok) {
      sendJson(socket, { type: "error", error: `stt_unavailable: ${tr.error || "no transcript"}` });
      return;
    }
    text = String(tr.text || "").trim();
    sendJson(socket, { type: "transcript", text, sessionId: state.sessionId });
  } catch (e) {
    sendJson(socket, { type: "error", error: `stt: ${e.message || e}` });
    return;
  } finally {
    state.pcm = null;
    state.opus = null;
    await fsp.unlink(tmp).catch(() => {});
  }

  if (!text) {
    sendJson(socket, { type: "error", error: "empty_transcript" });
    return;
  }
  await runVoiceTurn(state, cfg, { text, speak: opts.speak });
}

async function handleClientMessage(state, body, cfg) {
  const { socket, entente, sessionId } = state;
  const type = body?.type;

  if (type === "webrtc_offer") {
    const sdp = String(body.sdp || "").trim();
    if (!sdp) {
      sendJson(socket, { type: "error", error: "missing_sdp" });
      return;
    }
    try {
      const { acceptOffer } = await import("../voice/webrtc-session.mjs");
      const session = await acceptOffer(sdp, {
        iceServers: body.iceServers,
        onState: (s) =>
          sendJson(socket, { type: "event", event: "webrtc_state", state: s, sessionId }),
      });
      if (!session.ok) {
        sendJson(socket, { type: "error", error: `webrtc: ${session.error}` });
        return;
      }
      try {
        state.webrtc?.close?.();
      } catch {
        /* */
      }
      state.webrtc = session;
      sendJson(socket, {
        type: "webrtc_answer",
        sdp: session.answerSdp,
        engine: session.engine,
        sessionId,
      });
      // Trickle local candidates as they are gathered.
      session.drainIce?.((candidate) =>
        sendJson(socket, { type: "webrtc_ice", candidate, sessionId })
      );
    } catch (e) {
      sendJson(socket, { type: "error", error: `webrtc: ${e.message || e}` });
    }
    return;
  }

  if (type === "webrtc_ice") {
    if (!state.webrtc) {
      sendJson(socket, { type: "error", error: "no_webrtc_session" });
      return;
    }
    const r = await state.webrtc.addIce(body.candidate);
    if (!r?.ok) {
      sendJson(socket, { type: "error", error: `webrtc_ice: ${r?.error || "failed"}` });
      return;
    }
    sendJson(socket, { type: "event", event: "webrtc_ice_added", sessionId });
    return;
  }

  if (type === "webrtc_close") {
    try {
      await state.webrtc?.close?.();
    } catch {
      /* */
    }
    state.webrtc = null;
    sendJson(socket, { type: "event", event: "webrtc_closed", sessionId });
    return;
  }

  if (type === "pcm_start") {
    state.opus = null;
    state.pcm = {
      sampleRate: Number(body.sampleRate) || 16000,
      channels: Number(body.channels) || 1,
      chunks: [],
      bytes: 0,
    };
    sendJson(socket, { type: "event", event: "pcm_started", sessionId });
    return;
  }

  if (type === "pcm_end") {
    if (!state.pcm) {
      sendJson(socket, { type: "error", error: "no_pcm_session" });
      return;
    }
    if (state.busy) {
      sendJson(socket, { type: "error", error: "busy" });
      return;
    }
    state.busy = true;
    try {
      await finalizeAudioTurn(state, cfg, "pcm", { speak: body.speak });
    } finally {
      state.busy = false;
    }
    return;
  }

  if (type === "opus_start") {
    state.pcm = null;
    state.opus = {
      sampleRate: Number(body.sampleRate) || 16000,
      channels: Number(body.channels) || 1,
      container: body.container === "ogg" ? "ogg" : "packets",
      packets: [],
      bytes: 0,
    };
    sendJson(socket, { type: "event", event: "opus_started", sessionId });
    return;
  }

  if (type === "opus_end") {
    if (!state.opus) {
      sendJson(socket, { type: "error", error: "no_opus_session" });
      return;
    }
    if (state.busy) {
      sendJson(socket, { type: "error", error: "busy" });
      return;
    }
    state.busy = true;
    try {
      await finalizeAudioTurn(state, cfg, "opus", { speak: body.speak });
    } finally {
      state.busy = false;
    }
    return;
  }

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
      await runVoiceTurn(state, cfg, { text, speak: body.speak, ...body });
    } finally {
      state.busy = false;
    }
    return;
  }

  sendJson(socket, { type: "error", error: `unknown_type:${type}` });
}

/**
 * One voice turn: command intent → canned reply, otherwise the agent.
 * Shared by the text (utterance/command) and audio (pcm/opus) paths.
 * Caller owns state.busy.
 */
async function runVoiceTurn(state, cfg, body = {}) {
  const { socket, entente, sessionId } = state;
  const text = String(body.text || "").trim();
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
}

export default { attachVoiceWebSocket };
