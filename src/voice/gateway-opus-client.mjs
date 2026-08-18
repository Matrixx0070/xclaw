/**
 * Edge client: send Opus (or PCM) audio to gateway /ws/voice and wait for reply.
 */

import { encodePcmToOpusPackets, wavToPcm } from "./opus-encode.mjs";
import { resolveVoiceWsUrl } from "./ws-url.mjs";


/**
 * @param {Buffer} pcmOrWav
 * @param {{ url?: string, preferOpus?: boolean, sampleRate?: number, timeoutMs?: number, speak?: boolean }} [opts]
 */
export async function sendAudioToGateway(pcmOrWav, opts = {}) {
  const wsUrl = resolveVoiceWsUrl(opts);
  if (!wsUrl) {
    return { ok: false, error: "no_gateway_ws", skipped: true };
  }
  const WS = globalThis.WebSocket;
  if (!WS) {
    return { ok: false, error: "WebSocket not available" };
  }

  const sampleRate = opts.sampleRate || 16000;
  const pcm = wavToPcm(Buffer.isBuffer(pcmOrWav) ? pcmOrWav : Buffer.from(pcmOrWav));
  let useOpus = opts.preferOpus !== false;
  let packets = null;
  if (useOpus) {
    const enc = await encodePcmToOpusPackets(pcm, { sampleRate });
    if (enc.ok) packets = enc.packets;
    else useOpus = false;
  }

  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* */
      }
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, error: "timeout" }), timeoutMs);
    if (timer.unref) timer.unref();

    let ws;
    try {
      ws = new WS(wsUrl);
    } catch (e) {
      done({ ok: false, error: e.message || String(e) });
      return;
    }

    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      if (useOpus && packets) {
        ws.send(
          JSON.stringify({
            type: "opus_start",
            sampleRate,
            channels: 1,
            container: "packets",
          })
        );
        for (const pkt of packets) {
          ws.send(pkt);
        }
        ws.send(JSON.stringify({ type: "opus_end" }));
      } else {
        ws.send(
          JSON.stringify({
            type: "pcm_start",
            sampleRate,
            channels: 1,
          })
        );
        // chunk PCM ~40ms
        const chunk = Math.floor(sampleRate * 0.04) * 2;
        for (let i = 0; i < pcm.length; i += chunk) {
          ws.send(pcm.subarray(i, i + chunk));
        }
        ws.send(JSON.stringify({ type: "pcm_end" }));
      }
    });

    ws.addEventListener("message", (ev) => {
      try {
        const text =
          typeof ev.data === "string"
            ? ev.data
            : new TextDecoder().decode(ev.data);
        const msg = JSON.parse(text);
        if (msg.type === "reply") {
          done({
            ok: true,
            reply: msg.text,
            command: msg.command,
            transport: useOpus ? "opus" : "pcm",
          });
        }
        if (msg.type === "error") {
          done({ ok: false, error: msg.error, transport: useOpus ? "opus" : "pcm" });
        }
      } catch {
        /* */
      }
    });

    ws.addEventListener("error", () => done({ ok: false, error: "ws_error" }));
  });
}

export default { sendAudioToGateway };
