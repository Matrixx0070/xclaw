/**
 * Handle WS text control messages for stop-all (same auth as POST /stop).
 */
import { authorizeStopControl } from "./stop-control-auth.mjs";
import { handleStopAll } from "./stop-route.mjs";
import { recordLastDrain } from "./last-drain.mjs";

export function isStopControlBody(body) {
  if (!body || typeof body !== "object") return false;
  const t = String(body.type || body.action || "").toLowerCase();
  return t === "stop" || t === "stop-all" || t === "stop_all" || t === "kill_switch";
}

/**
 * @returns {Promise<{handled:boolean, ok?:boolean, error?:string, payload?:object}>}
 */
export async function handleWsStopControl(body, cfg = {}, sendJson) {
  if (!isStopControlBody(body)) return { handled: false };
  const auth = authorizeStopControl(
    {
      token: body.token,
      sig: body.sig || body.signature,
      body: body.body || { type: "stop", action: body.action || "stop-all" },
      headers: body.headers,
    },
    cfg
  );
  if (!auth.ok) {
    const payload = {
      type: "stop_result",
      ok: false,
      error: auth.code || "STOP_UNAUTHORIZED",
      message: auth.message,
      authMethod: auth.authMethod || null,
      channel: "ws",
    };
    try {
      sendJson?.(payload);
    } catch {
      /* */
    }
    return { handled: true, ok: false, error: auth.code, payload };
  }
  const fakeReq = {
    method: "POST",
    headers: {
      ...(body.token ? { "x-xclaw-token": body.token } : {}),
      ...(body.sig || body.signature
        ? { "x-xclaw-stop-sig": body.sig || body.signature }
        : {}),
      ...(body.headers || {}),
    },
    body: body.body || { type: "stop" },
  };
  const result = await handleStopAll(fakeReq, null, { cfg });
  const authMethod =
    result?.authMethod || result?.drain?.authMethod || auth.authMethod || null;
  if (result?.drain) {
    try {
      recordLastDrain(
        { ...result.drain, authMethod, channel: "ws" },
        { cfg, channel: "ws" }
      );
    } catch {
      /* */
    }
  }
  const payload = {
    type: "stop_result",
    ok: result?.ok !== false,
    drain: result?.drain
      ? { ...result.drain, authMethod, channel: "ws" }
      : null,
    killedSessions: result?.killedSessions || [],
    authMethod,
    channel: "ws",
  };
  try {
    sendJson?.(payload);
  } catch {
    /* */
  }
  return { handled: true, ok: payload.ok, payload };
}

export default { isStopControlBody, handleWsStopControl };
