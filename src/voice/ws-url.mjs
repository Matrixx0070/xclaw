/**
 * Shared /ws/voice URL builder for the edge clients.
 *
 * A gateway with security.token (or requireAuth) rejects the WebSocket upgrade
 * unless the token rides along; browsers cannot set headers on a WebSocket, so
 * the gateway accepts a ?token= query param and the clients use that.
 */

/** Turn an http(s)/ws base into a /ws/voice URL, carrying the token when set. */
export function resolveVoiceWsUrl(opts = {}) {
  const base =
    opts.url ||
    process.env.XCLAW_VOICE_WS ||
    process.env.XCLAW_GATEWAY_WS ||
    "";
  if (!base) return null;

  let url;
  if (base.startsWith("http://")) {
    url = base.replace(/^http/, "ws").replace(/\/?$/, "") + "/ws/voice";
  } else if (base.startsWith("https://")) {
    url = base.replace(/^https/, "wss").replace(/\/?$/, "") + "/ws/voice";
  } else if (!base.includes("/ws/")) {
    url = base.replace(/\/?$/, "") + "/ws/voice";
  } else {
    url = base;
  }

  const token =
    opts.token ||
    process.env.XCLAW_GATEWAY_TOKEN ||
    process.env.GATEWAY_TOKEN ||
    "";
  if (token && !/[?&]token=/.test(url)) {
    url += (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  }
  return url;
}

export default { resolveVoiceWsUrl };
