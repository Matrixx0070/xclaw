/**
 * Gateway swarm read/approval HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   GET  /swarm/merges
 *   POST /swarm/merges/:id/approve
 *   POST /swarm/merges/:id/reject
 *   GET  /swarm/merges/:id
 *   GET  /swarm/:id
 *
 * The /swarm/run + /swarm/run/stream POST routes stay in index.mjs — they own
 * SSE writer closures that don't extract cleanly.
 */

/**
 * @param {object} args
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleSwarmRoute({ p, method, req, res, url, cfg, json, readBody }) {
  if (p === "/swarm/merges" && method === "GET") {
    const { listMergeProposals } = await import("../../agents/swarm-merge.mjs");
    const statusFilter = url.searchParams.get("status") || undefined;
    const limit = Number(url.searchParams.get("limit") || 30);
    const items = await listMergeProposals(cfg, { status: statusFilter, limit });
    json(res, 200, { count: items.length, proposals: items });
    return true;
  }

  if (p.startsWith("/swarm/merges/") && p.endsWith("/approve") && method === "POST") {
    const { approveMergeProposal } = await import("../../agents/swarm-merge.mjs");
    const id = p.slice("/swarm/merges/".length, p.length - "/approve".length);
    const body = await readBody(req).catch(() => ({}));
    const result = await approveMergeProposal(cfg, id, {
      repoDir: body.repo || body.repoDir,
      checkOnly: body.checkOnly === true,
    });
    json(res, result.ok ? 200 : 422, result);
    return true;
  }

  if (p.startsWith("/swarm/merges/") && p.endsWith("/reject") && method === "POST") {
    const { rejectMergeProposal } = await import("../../agents/swarm-merge.mjs");
    const id = p.slice("/swarm/merges/".length, p.length - "/reject".length);
    const body = await readBody(req).catch(() => ({}));
    const result = await rejectMergeProposal(cfg, id, body.reason || "");
    json(res, result.ok ? 200 : 422, result);
    return true;
  }

  if (p.startsWith("/swarm/merges/") && method === "GET") {
    const { getMergeProposal } = await import("../../agents/swarm-merge.mjs");
    const id = p.slice("/swarm/merges/".length).split("/")[0];
    const rec = await getMergeProposal(cfg, id);
    if (!rec) {
      json(res, 404, { error: "merge proposal not found", id });
      return true;
    }
    json(res, 200, rec);
    return true;
  }

  if (p.startsWith("/swarm/") && method === "GET") {
    const { getSwarmRun } = await import("../../agents/swarm-store.mjs");
    const id = p.slice("/swarm/".length).split("/")[0];
    if (!id || id === "run" || id === "merges") {
      json(res, 404, { error: "not found" });
      return true;
    }
    const run = await getSwarmRun(cfg, id);
    if (!run) {
      json(res, 404, { error: "swarm run not found", id });
      return true;
    }
    json(res, 200, run);
    return true;
  }

  return false;
}

export default { tryHandleSwarmRoute };
