/**
 * Gateway subagent HTTP routes (split from routes/api.mjs).
 *
 * Paths:
 *   GET  /subagents · /subagents/:id
 *   POST /subagents/spawn · /subagents/merge
 */
import { spawnSubagent, listSubagents, getSubagent } from "../../agents/spawn.mjs";

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleSubagentsRoute({ p, method, req, res, cfg, json, readBody }) {
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

  return false;
}

export default { tryHandleSubagentsRoute };
