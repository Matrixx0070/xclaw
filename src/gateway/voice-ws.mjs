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
import { voiceClientEvent } from "./voice-events.mjs";

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
 * @param {{ cfg?: object, path?: string, authorize?: (req: object) => { ok: boolean, protocol?: string } }} opts
 *   `authorize` is the SAME function /ws/events uses (gatewayAuth.authorizeWebSocket).
 *   One decision function for every upgrade — see the gate below.
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

    // Auth gate BEFORE the 101 handshake, using the same path-independent
    // decision as /ws/events. This used to ask `auth.isProtectedPath("/ws/voice")`
    // first — and no protection list contains "/ws/voice", so the answer was
    // always false and the gate never ran. From 3.131.0 (b4ecb14) to 3.191.0
    // ANY unauthenticated client could open this socket on a token-protected
    // gateway and send {"type":"command"}, which reaches runAgent with the full
    // tool pack. The events hub was never affected: it asks authorizeWebSocket,
    // which gates on "is a token configured", not on the path. Two decision
    // functions for one question is the bug; there is now one.
    let authProtocol;
    if (typeof opts.authorize === "function") {
      let verdict;
      try {
        verdict = opts.authorize(req);
      } catch (err) {
        verdict = { ok: false, error: err?.message || "authorize error" };
      }
      if (!verdict?.ok) {
        socket.write(
          "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
        );
        socket.destroy();
        return;
      }
      authProtocol = verdict.protocol;
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
      // Echo the token subprotocol or a browser fails the handshake — that
      // carrier is the only way a browser can authenticate an upgrade.
      ...(authProtocol ? [`Sec-WebSocket-Protocol: ${authProtocol}`] : []),
      "",
      "",
    ].join("\r\n");
    socket.write(ack);
    if (head?.length) socket.unshift(head);

    const sessionId = crypto.randomUUID();
    // Conversation continuity: a client may pass ?conversation=<id> to resume
    // its own thread across reconnects (a dropped socket should not amnesia the
    // user); otherwise the connection itself is the conversation.
    const conversationId =
      url.searchParams.get("conversation") ||
      url.searchParams.get("conversationId") ||
      `voice_${sessionId}`;
    const workingDir =
      cfg.voice?.workingDir || cfg.paths?.workspaces || process.cwd();
    const entente = createEntente();
    const parser = createFrameParser();
    const state = {
      sessionId,
      conversationId,
      workingDir,
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
      conversationId,
      workingDir,
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
    const { toSpeakableText } = await import("../voice/speakable.mjs");
    tts = await localSpeak(toSpeakableText(text, { maxChars: 400 }), cfg);
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

  // Agent path — a voice session is a CONVERSATION, so it runs the same
  // channel-invariant agent webchat uses, keyed by a stable conversation id.
  // (It used to spawn a fresh runJob per utterance: every turn started with no
  // history, in an empty /tmp job workspace, so "now do the same for X" and
  // "read my config" could never work.)
  let reply = "";
  try {
    const { runAgent } = await import("../agent/run-agent.mjs");
    const out = await runAgent({
      goal: text,
      cfg,
      channel: "voice",
      chatSessionId: state.conversationId,
      workingDir: state.workingDir,
      onEvent: (e) => {
        // Tool progress AND anything the turn is waiting on a human for. The
        // hand-written filter that used to live here forwarded only tool
        // start/end, so a pending approval reached the caller through no
        // surface at all and the turn simply went quiet for two minutes.
        const frame = voiceClientEvent(e, { sessionId });
        if (frame) sendJson(socket, frame);
      },
    });
    // Same auto-promote as webchat: a turn-cap cutoff is an execution
    // constraint, not completion. Voice used to slice and speak the
    // truncated reply, so a spoken cutoff never became a durable
    // objective. Named conversationId already persists — do not mint
    // persistRun. Gateway stays alive, so the mission is detached.
    let spoken = out.text || out.error || "";
    if (cfg.objectives?.enabled !== false) {
      try {
        const { autoPromoteIfNeeded, formatPromotedReply } = await import(
          "../channels/runtime.mjs"
        );
        const { replyWithAgent } = await import("../channels/base.mjs");
        const promo = await autoPromoteIfNeeded({
          text,
          inbound: {
            channel: "voice",
            chatId: state.conversationId,
            userId: state.conversationId,
            identity: `voice:${state.conversationId}`,
          },
          cfg,
          workingDir: state.workingDir,
          replyWithAgent,
          onEvent: (e) => {
            const frame = voiceClientEvent(e, { sessionId });
            if (frame) sendJson(socket, frame);
          },
          notify: async (t) => {
            sendJson(socket, {
              type: "event",
              event: "objective",
              text: String(t).slice(0, 2000),
              sessionId,
            });
          },
          turnResult: out,
        });
        if (promo) spoken = formatPromotedReply(out.text, promo.id);
      } catch (err) {
        sendJson(socket, {
          type: "event",
          event: "objective",
          phase: "promote_error",
          message: String(err?.message || err),
          sessionId,
        });
      }
    }
    reply = String(spoken).slice(0, 2000);
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
