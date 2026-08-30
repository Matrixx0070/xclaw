/**
 * Opt-in CLI handoff to a running gateway.
 *
 * Extracted from the switch in bin/xclaw.mjs so the decision can be tested:
 * a `case` block inside a 2000-line binary is untestable by construction.
 *
 * Default is in-process (`xclaw agent` / `job` / `runs resume`). `--gateway`
 * (boolean presence — not the URL form `xclaw run --gateway <url>` uses) POSTs
 * to the already-running gateway. If the gateway is unreachable or rejects,
 * fail closed: no silent in-process fallback (pause/resume analog, not add).
 *
 * Agent/job POSTs outlive the queue-control 4000ms default; pass timeoutMs
 * here, do not change gatewayPost's default.
 */
import { gatewayGet, gatewayPost } from "./gateway-client.mjs";

/** Agent/job loops and a detached resume ack. Queue control stays at 4000. */
export const HANDOFF_TIMEOUT_MS = 180000;
/** Reachability probe. Doctor uses 3000ms; do not wait HANDOFF_TIMEOUT_MS. */
export const PROBE_TIMEOUT_MS = 3000;

/**
 * Strip `--gateway` (boolean presence) so it is not part of the prompt/goal.
 * Does not consume the next argv token as a URL.
 *
 * @param {string[]} argv
 * @returns {{ viaGateway: boolean, rest: string[] }}
 */
export function takeGatewayFlag(argv = []) {
  let viaGateway = false;
  const rest = [];
  for (const a of argv) {
    if (a === "--gateway") viaGateway = true;
    else rest.push(a);
  }
  return { viaGateway, rest };
}

function failClosed(r, verb) {
  return {
    ok: false,
    exitCode: 1,
    status: r.status,
    body: r.body,
    error: `${r.error} — cannot ${verb} via gateway: no gateway is running (or it rejected the request)`,
  };
}

/**
 * GET /health before any local stamp. `runs resume --gateway` must not mark
 * a snapshot resumedAt/objectiveId when the owner is down — stamp-then-POST
 * is one-way (isResumableAgentRun returns false once stamped).
 *
 * Probe timeout is short (PROBE_TIMEOUT_MS), not HANDOFF_TIMEOUT_MS.
 *
 * @returns {Promise<{ok: boolean, exitCode?: number, error?: string, status?: number, body?: any}>}
 */
export async function probeGateway(cfg, deps = {}) {
  const { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = deps;
  const r = await gatewayGet(cfg, "/health", { fetchImpl, timeoutMs });
  if (!r.ok) return failClosed(r, "reach");
  return { ok: true, status: r.status, body: r.body };
}

/**
 * @param {object} cfg
 * @param {"agent"|"job"|"resume"} kind
 * @param {{message?: string, sessionId?: string, workingDir?: string, goal?: string, autoApprove?: boolean, objectiveId?: string}} payload
 * @param {{fetchImpl?: Function, timeoutMs?: number}} deps
 * @returns {Promise<{ok: boolean, via?: "gateway", result?: any, error?: string, exitCode?: number, status?: number, body?: any}>}
 */
export async function runGatewayHandoff(cfg, kind, payload = {}, deps = {}) {
  const { fetchImpl = fetch, timeoutMs = HANDOFF_TIMEOUT_MS } = deps;
  const post = (path, body) => gatewayPost(cfg, path, body, { fetchImpl, timeoutMs });

  if (kind === "agent") {
    const body = {
      message: payload.message,
      workingDir: payload.workingDir || process.cwd(),
    };
    if (payload.sessionId) body.sessionId = payload.sessionId;
    const r = await post("/agent/run", body);
    if (!r.ok) return failClosed(r, "run agent");
    return { ok: true, via: "gateway", result: r.body };
  }

  if (kind === "job") {
    const r = await post("/jobs", {
      goal: payload.goal,
      autoApprove: payload.autoApprove !== false,
    });
    // POST /jobs uses 422 for a completed job that did not pass — that is
    // the application verdict, not a transport failure. 401/400/ECONNREFUSED
    // still fail closed.
    if (r.status === 422 && r.body && r.body.id) {
      return { ok: true, via: "gateway", result: r.body };
    }
    if (!r.ok) return failClosed(r, "run job");
    return { ok: true, via: "gateway", result: r.body };
  }

  if (kind === "resume") {
    const id = payload.objectiveId;
    if (!id) return { ok: false, exitCode: 1, error: "objectiveId required" };
    const r = await post(`/objectives/${id}/resume`, {});
    if (!r.ok) return failClosed(r, "resume objective");
    return { ok: true, via: "gateway", result: r.body };
  }

  return { ok: false, exitCode: 1, error: `unknown handoff: ${kind}` };
}
