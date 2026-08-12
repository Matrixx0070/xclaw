/**
 * Gateway agent-plane API HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   GET  /skills · /memory · /transcripts · /transcripts/:id
 *   GET  /subagents · /subagents/:id · POST /subagents/spawn · /subagents/merge
 *   GET  /sessions · /sessions/by-key · POST /sessions · /sessions/bind
 *        /sessions/resolve · /sessions/keys
 *   GET  /checkpoints · POST /checkpoints/resume
 *   POST /mcp · /mcp/call · GET /mcp/tools
 *   GET  /providers/route
 *   GET|POST /media/canvas · GET /media/canvas/:id · /media/providers
 *   GET|POST /media/jobs · GET /media/jobs/:id
 */
import { loadAllSkills, loadMemoryFiles } from "../../skills/loader.mjs";
import { spawnSubagent, listSubagents, getSubagent } from "../../agents/spawn.mjs";
import {
  listSessions,
  createSession,
  resolveBinding,
  bindPeer,
  buildSessionKey,
  parseSessionKey,
  getSessionByKey,
} from "../../sessions/router.mjs";
import { resolveProviderRoute } from "../../providers/router.mjs";
import {
  createCanvas,
  getCanvas,
  enqueueMediaJob,
  listMediaJobs,
  listCanvases,
  listImageProviders,
  getMediaJob,
} from "../../media/canvas.mjs";

/**
 * @param {object} args — standard route args + mcpClient, mcpServer (live)
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleApiRoute({
  p,
  method,
  req,
  res,
  url,
  cfg,
  json,
  readBody,
  mcpClient,
  mcpServer,
}) {
  // --- Skills / memory ---
  if (p === "/skills" && method === "GET") {
    const skills = await loadAllSkills({
      configDir: cfg.paths?.configDir,
      cwd: process.cwd(),
    });
    json(res, 200, {
      skills: skills.map((s) => ({
        name: s.name,
        description: s.description,
        path: s.path,
      })),
    });
    return true;
  }

  if (p === "/memory" && method === "GET") {
    const cwd = new URL(req.url, "http://x").searchParams.get("cwd") || process.cwd();
    const files = await loadMemoryFiles(cwd);
    json(res, 200, {
      files: files.map((f) => ({
        name: f.name,
        path: f.path,
        chars: f.body.length,
        preview: f.body.slice(0, 200),
      })),
    });
    return true;
  }

  // --- Transcripts (inspectable local conversation log) ---
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

  // --- Parity APIs (gaps 1–10) ---
  if (p === "/subagents" && method === "GET") {
    json(res, 200, { subagents: listSubagents() });
    return true;
  }
  if (p === "/subagents/spawn" && method === "POST") {
    const body = await readBody(req);
    if (!body.task) {
      json(res, 400, { error: "task required" });
      return true;
    }
    const out = await spawnSubagent({
      task: body.task,
      maxTurns: body.maxTurns,
      cfg,
      parentId: body.parentId,
      workingDir: body.workingDir,
    });
    json(res, out.ok ? 200 : 500, out);
    return true;
  }
  if (p === "/subagents/merge" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { mergeSubagentWorktree } = await import("../../agents/worktree.mjs");
    const rec = getSubagent(body.subagentId);
    if (!rec) {
      json(res, 404, { error: "subagent not found" });
      return true;
    }
    const repo = body.repo || process.cwd();
    const out = await mergeSubagentWorktree(
      { result: rec.result, worktree: rec },
      repo,
      { checkOnly: Boolean(body.checkOnly) }
    );
    json(res, out.ok ? 200 : 409, out);
    return true;
  }
  if (p.startsWith("/subagents/") && method === "GET") {
    const id = p.slice("/subagents/".length);
    const s = getSubagent(id);
    if (s) json(res, 200, s);
    else json(res, 404, { error: "not found" });
    return true;
  }

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

  if (p === "/mcp" && method === "POST") {
    const body = await readBody(req);
    const out = await mcpServer.handleRequest(body);
    json(res, 200, out);
    return true;
  }
  if (p === "/mcp/tools" && method === "GET") {
    const tools = await mcpClient.listTools();
    json(res, 200, { tools });
    return true;
  }
  if (p === "/mcp/call" && method === "POST") {
    const body = await readBody(req);
    const out = await mcpClient.callTool(body.name, body.arguments || body.args || {});
    json(res, 200, out);
    return true;
  }

  if (p === "/providers/route" && method === "GET") {
    const model = url.searchParams.get("model") || undefined;
    json(res, 200, resolveProviderRoute(cfg, { model }));
    return true;
  }

  if (p === "/media/canvas" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    json(res, 200, createCanvas(body));
    return true;
  }
  if (p.startsWith("/media/canvas/") && method === "GET") {
    const c = getCanvas(p.slice("/media/canvas/".length));
    if (c) json(res, 200, c);
    else json(res, 404, { error: "not found" });
    return true;
  }
  if (p === "/media/providers" && method === "GET") {
    json(res, 200, { providers: listImageProviders() });
    return true;
  }
  if (p === "/media/canvas" && method === "GET") {
    json(res, 200, { canvases: listCanvases() });
    return true;
  }
  if (p === "/media/jobs" && method === "GET") {
    json(res, 200, { jobs: listMediaJobs() });
    return true;
  }
  if (p.startsWith("/media/jobs/") && method === "GET") {
    const job = getMediaJob(p.slice("/media/jobs/".length));
    if (job) json(res, 200, job);
    else json(res, 404, { error: "not found" });
    return true;
  }
  if (p === "/media/jobs" && method === "POST") {
    const body = await readBody(req);
    json(res, 200, enqueueMediaJob(body));
    return true;
  }

  return false;
}

export default { tryHandleApiRoute };
