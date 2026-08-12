/**
 * Gateway conversation-state HTTP routes (split from routes/api.mjs).
 *
 * Paths:
 *   GET  /sessions · /sessions/by-key · POST /sessions · /sessions/bind
 *        /sessions/resolve · /sessions/keys
 *   GET  /transcripts · /transcripts/:id
 *   GET  /checkpoints · POST /checkpoints/resume
 */
import {
  listSessions,
  createSession,
  resolveBinding,
  bindPeer,
  buildSessionKey,
  parseSessionKey,
  getSessionByKey,
} from "../../sessions/router.mjs";

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleSessionsRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (p === "/sessions" && method === "GET") {
    json(res, 200, { sessions: listSessions() });
    return true;
  }
  if (p === "/sessions" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    json(res, 200, createSession(body));
    return true;
  }
  if (p === "/sessions/bind" && method === "POST") {
    const body = await readBody(req);
    const s = bindPeer(body.channel, body.peerId, body.sessionId);
    json(res, 200, { ok: true, session: s });
    return true;
  }
  if (p === "/sessions/resolve" && method === "POST") {
    const body = await readBody(req);
    json(res, 200, resolveBinding(body.channel, body.peerId, body.peerKind));
    return true;
  }
  if (p === "/sessions/keys" && method === "POST") {
    const body = await readBody(req);
    if (body.sessionKey) {
      json(res, 200, { parsed: parseSessionKey(body.sessionKey) });
      return true;
    }
    json(res, 200, { sessionKey: buildSessionKey(body) });
    return true;
  }
  if (p === "/sessions/by-key" && method === "GET") {
    const key = url.searchParams.get("key");
    const s = getSessionByKey(key);
    if (s) json(res, 200, s);
    else json(res, 404, { error: "not found" });
    return true;
  }

  if (p === "/transcripts" && method === "GET") {
    const { listTranscripts } = await import("../../sessions/transcript.mjs");
    json(res, 200, { transcripts: listTranscripts(cfg) });
    return true;
  }
  if (p.startsWith("/transcripts/") && method === "GET") {
    const { loadTranscriptHistory, transcriptPath } = await import("../../sessions/transcript.mjs");
    const id = decodeURIComponent(p.slice("/transcripts/".length).split("/")[0]);
    const history = loadTranscriptHistory(cfg, id, Number(new URL(req.url, "http://local").searchParams.get("limit") || 200));
    json(res, 200, { sessionId: id, path: transcriptPath(cfg, id), history, count: history.length });
    return true;
  }

  if (p === "/checkpoints" && method === "GET") {
    const { listCheckpoints, loadCheckpoint } = await import("../../jobs/checkpoint.mjs");
    const id = url.searchParams.get("id");
    if (id) {
      try {
        json(res, 200, await loadCheckpoint(cfg, id));
      } catch (e) {
        json(res, 404, { error: e.message });
      }
      return true;
    }
    json(res, 200, { checkpoints: await listCheckpoints(cfg, { limit: Number(url.searchParams.get("limit") || 30) }) });
    return true;
  }
  if (p === "/checkpoints/resume" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { resumeJobFromCheckpoint } = await import("../../jobs/checkpoint.mjs");
    try {
      const job = await resumeJobFromCheckpoint(cfg, body.id, { autoApprove: body.autoApprove });
      json(res, 200, { id: job.id, pass: job.pass, status: job.status, turns: job.turns, resumedFrom: job.resumedFrom });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }

  return false;
}

export default { tryHandleSessionsRoute };
