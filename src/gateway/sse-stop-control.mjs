/**
 * SSE control-plane stop (same auth as POST /stop + WS).
 * Channel stamped lastDrain.channel = "sse".
 */
import { authorizeStopControl } from "./stop-control-auth.mjs";
import { handleStopAll } from "./stop-route.mjs";
import { recordLastDrain } from "./last-drain.mjs";
import { isStopControlBody } from "./ws-stop-control.mjs";

export { isStopControlBody };

export async function handleSseStopControl(body, cfg = {}, sendEvent) {
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
      channel: "sse",
    };
    try {
      sendEvent?.(payload);
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
        { ...result.drain, authMethod, channel: "sse" },
        { cfg, channel: "sse" }
      );
    } catch {
      /* */
    }
  }
  const payload = {
    type: "stop_result",
    ok: result?.ok !== false,
    drain: result?.drain
      ? { ...result.drain, authMethod, channel: "sse" }
      : null,
    killedSessions: result?.killedSessions || [],
    authMethod,
    channel: "sse",
  };
  try {
    sendEvent?.(payload);
  } catch {
    /* */
  }
  return { handled: true, ok: payload.ok, payload };
}

export default { isStopControlBody, handleSseStopControl };
