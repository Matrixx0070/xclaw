/**
 * Optional bridge: local listen edge → gateway /ws/voice
 * Uses Node undici/websocket if available (Node 22+).
 */

import { resolveVoiceWsUrl } from "./ws-url.mjs";

/**
 * @param {string} text
 * @param {{ url?: string, token?: string, speak?: boolean, timeoutMs?: number }} [opts]
 */
export async function sendUtteranceToGateway(text, opts = {}) {
  const wsUrl = resolveVoiceWsUrl(opts);
  if (!wsUrl) {
    return { ok: false, error: "no_gateway_ws", skipped: true };
  }

  const WS = globalThis.WebSocket;
  if (!WS) {
    return { ok: false, error: "WebSocket not available in this runtime" };
  }

  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      // Always clear the timer and close the socket: a lingering open socket
      // keeps the event loop alive, so a one-shot caller never exits.
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
      clearTimeout(timer);
      done({ ok: false, error: e.message || String(e) });
      return;
    }

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "utterance",
          text,
          speak: opts.speak !== false,
        })
      );
    });
    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.type === "reply") {
          clearTimeout(timer);
          done({ ok: true, reply: msg.text, command: msg.command, tts: msg.tts });
        }
        if (msg.type === "error") {
          clearTimeout(timer);
          done({ ok: false, error: msg.error });
        }
      } catch {
        /* */
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      done({ ok: false, error: "ws_error" });
    });
  });
}

export default { sendUtteranceToGateway };
