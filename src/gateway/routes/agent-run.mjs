/**
 * Gateway /agent/run routes (extracted from gateway/index.mjs, W2).
 *
 * Paths:
 *   POST /agent/run        — one-shot agent loop, JSON result
 *   POST /agent/run/stream — SSE/NDJSON stream (delegates to the caller's
 *        streamAgentRun, which owns the writer/reconnect state in index.mjs)
 *
 * runAgentLoop / noteEviction / streamAgentRun are passed in — they are
 * gateway-closure collaborators, not importable singletons.
 */
import { clientErrorStatus } from "../../shared/http-error.mjs";

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleAgentRunRoute({
  p,
  method,
  req,
  res,
  cfg,
  json,
  readBody,
  runAgentLoop,
  noteEviction,
  streamAgentRun,
}) {
  if (p === "/agent/run" && method === "POST") {
    const body = await readBody(req);
    const message = body.message || body.prompt || body.text;
    if (!message || typeof message !== "string") {
      json(res, 400, { error: "body.message (string) required" });
      return true;
    }
    const events = [];
    try {
      const result = await runAgentLoop({
        userMessage: message,
        cfg,
        workingDir: body.workingDir || process.cwd(),
        chatSessionId: body.sessionId || body.chatSessionId || body.conversationId || null,
        history: Array.isArray(body.history)
          ? body.history
          : Array.isArray(body.messages)
            ? body.messages
            : [],
        onEvent: (e) => {
          noteEviction(e, "agent/run");
          events.push({ ...e, at: Date.now() });
          if (body.verbose) console.log(`[agent]`, e.type, e.phase || "", e.name || "");
        },
      });
      json(res, 200, {
        ok: true,
        ...result,
        events: body.includeEvents ? events : undefined,
      });
    } catch (err) {
      json(res, clientErrorStatus(err) ?? 500, {
        ok: false,
        error: err.message || String(err),
        events: body.includeEvents ? events : undefined,
      });
    }
    return true;
  }

  if (p === "/agent/run/stream" && method === "POST") {
    const body = await readBody(req);
    const message = body.message || body.prompt || body.text;
    // Allow resume without message when streamId is present
    const isResume =
      body.resume === true ||
      body.attach === true ||
      (body.streamId && (body.lastEventId || req.headers["last-event-id"]));
    if ((!message || typeof message !== "string") && !isResume) {
      json(res, 400, { error: "body.message (string) required" });
      return true;
    }
    await streamAgentRun(req, res, {
      message,
      workingDir: body.workingDir,
      cfg,
      body,
    });
    return true;
  }
  return false;
}

export default { tryHandleAgentRunRoute };
