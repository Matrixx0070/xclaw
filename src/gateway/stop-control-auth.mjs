/**
 * Auth for WS/SSE control-plane stop messages (same surface as POST /stop).
 */
import { authorizeStop, signStopBody, extractStopToken, stopAuthToken } from "./stop-auth.mjs";

/**
 * Normalize a control-plane stop message into a fake req for authorizeStop.
 * @param {{ headers?: object, token?: string, sig?: string, body?: object|string }} msg
 */
export function controlMsgToStopReq(msg = {}) {
  const headers = { ...(msg.headers || {}) };
  if (msg.token) headers["x-xclaw-token"] = msg.token;
  if (msg.sig) headers["x-xclaw-stop-sig"] = msg.sig;
  let body = msg.body;
  if (body == null) body = { type: "stop", action: msg.action || "stop-all" };
  return { headers, body, url: "/stop" };
}

export function authorizeStopControl(msg, cfg = {}) {
  return authorizeStop(controlMsgToStopReq(msg), cfg);
}

/** Helper for clients: build signed control stop payload */
export function buildStopControlMessage(cfg = {}, body = { type: "stop" }) {
  const token = stopAuthToken(cfg);
  const secret = cfg.gateway?.stopHmacSecret || process.env.XCLAW_STOP_HMAC_SECRET || "";
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const out = { type: "stop", body, token: token || undefined };
  if (secret) out.sig = signStopBody(secret, raw);
  return out;
}

export default {
  authorizeStopControl,
  controlMsgToStopReq,
  buildStopControlMessage,
  extractStopToken,
};
