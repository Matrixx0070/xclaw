/**
 * Gateway approvals + agent-runs routes (extracted from gateway/index.mjs, W2).
 *
 * Paths:
 *   GET  /approvals · /approvals/pending — pending tool approvals
 *   POST /approvals/approve · /approvals/deny — decide a pending
 *   GET  /agent-runs[?id=] — persisted agent run listing / single run
 */

/** @returns {Promise<boolean>} true if handled */
export async function tryHandleApprovalsRoute({
  p,
  method,
  req,
  res,
  url,
  cfg,
  json,
  readBody,
  approvalGate,
}) {
  if ((p === "/approvals" || p === "/approvals/pending") && method === "GET") {
    json(res, 200, { pending: approvalGate.listPending() });
    return true;
  }
  if (p === "/approvals/approve" && method === "POST") {
    const body = await readBody(req);
    const out = approvalGate.decide(body.id, true, body.note || body.reason || "");
    const status = out.ok ? 200 : out.code === "APPROVAL_NOT_FOUND" ? 404 : 409;
    json(res, status, out);
    return true;
  }
  if (p === "/approvals/deny" && method === "POST") {
    const body = await readBody(req);
    const out = approvalGate.decide(body.id, false, body.note || body.reason || "Denied");
    const status = out.ok ? 200 : out.code === "APPROVAL_NOT_FOUND" ? 404 : 409;
    json(res, status, out);
    return true;
  }
  if (p === "/agent-runs" && method === "GET") {
    const { listAgentRuns, loadAgentRun } = await import("../../agent/run-store.mjs");
    const id = url.searchParams.get("id");
    if (id) {
      const out = await loadAgentRun(cfg, id);
      json(res, out.ok ? 200 : out.code === "SESSION_NOT_FOUND" ? 404 : 400, out);
      return true;
    }
    json(res, 200, {
      runs: await listAgentRuns(cfg, { limit: Number(url.searchParams.get("limit") || 30) }),
    });
    return true;
  }
  return false;
}

export default { tryHandleApprovalsRoute };
