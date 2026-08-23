/**
 * Long-run objective HTTP routes — the ops surface the chat commands lack.
 * Without these, an awaiting_human mission whose escalation DM was missed
 * sat invisible forever (no routes, no UI, no doctor signal).
 *
 * Paths (operator-token gated in BOTH auth modes via the core list):
 *   GET  /objectives            — summaries (newest first)
 *   GET  /objectives/:id        — full state
 *   POST /objectives            — {objective, workingDir?, verify?} start detached (gateway-run);
 *       verify = typed checks (jobs/verify.mjs shape) gating every done-path
 *   POST /objectives/:id/stop   — request stop at the next segment boundary
 *   POST /objectives/:id/resume — {answer?} resume interrupted/paused/awaiting/stopped
 */
import {
  listObjectives,
  loadObjective,
  saveObjective,
  isTerminalObjective,
} from "../../agent/objective-store.mjs";

function summarize(o) {
  return {
    id: o.id,
    status: o.status,
    objective: o.objective.slice(0, 200),
    channel: o.channel,
    chatId: o.chatId,
    segments: o.totals.segments,
    toolCalls: o.totals.toolCalls,
    criteriaDone: o.criteria.filter((c) => c.done).length,
    criteriaTotal: o.criteria.length,
    currentSubtask: o.currentSubtask || null,
    humanQuestion: o.humanQuestion || null,
    updatedAt: o.updatedAt,
    createdAt: o.createdAt,
  };
}

/** Gateway-side detached runner: default agent plumbing, WS notify. */
async function startGatewayObjective(cfg, runOpts, { workingDir, notify: notifyOverride } = {}) {
  const { replyWithAgent } = await import("../../channels/base.mjs");
  const { runObjective } = await import("../../agent/objective.mjs");
  const wd = workingDir || cfg.paths?.workspaces || process.cwd();
  const runSegment = async ({ prompt, rescuePrompt, sessionId }) =>
    replyWithAgent({
      cfg,
      message: prompt,
      workingDir: wd,
      channel: "api",
      onEvent: () => {},
      history: [],
      chatSessionId: sessionId,
      rescuePrompt,
    });
  const notify = async (text, meta) => {
    try {
      globalThis.__xclawWsBroadcast?.("objective", {
        type: "objective",
        phase: "notify",
        kind: meta?.kind || "info",
        text: String(text).slice(0, 2000),
      });
    } catch {
      /* hub optional */
    }
    if (notifyOverride) {
      try {
        await notifyOverride(text, meta);
      } catch {
        /* override best-effort */
      }
    }
  };
  runObjective(cfg, { ...runOpts, workingDir: wd, runSegment, notify }).catch((err) => {
    console.warn("[xclaw:objectives] run error:", err?.message || err);
  });
}

/**
 * Trust Sprint: boot auto-resume of crash-interrupted objectives. Before
 * this, reconcile marked them "interrupted" and they sat idle until the
 * owner's next chat message or a manual POST /resume (live benchmark H).
 * Notifications route to the WS hub AND the shared alerter (owner DM when
 * alerting targets are wired) so a mission that finishes headless is heard.
 */
export async function resumeObjectiveDetached(cfg, obj) {
  const notify = async (text, meta) => {
    try {
      const { getSharedAlerter } = await import("../../alerting/alerts.mjs");
      await getSharedAlerter(cfg).send({
        key: `objective:${obj.id}:${meta?.kind || "info"}`,
        severity: meta?.kind === "error" ? "error" : "info",
        title: `Mission ${obj.id} (auto-resumed after restart)`,
        body: String(text).slice(0, 1500),
        meta: { objectiveId: obj.id, kind: meta?.kind || "info" },
      });
    } catch {
      /* alerter optional */
    }
  };
  await startGatewayObjective(cfg, { resumeId: obj.id }, { workingDir: obj.workingDir, notify });
}

export async function tryHandleObjectivesRoute({ p, method, req, cfg, res, json, readBody }) {
  if (p !== "/objectives" && !p.startsWith("/objectives/")) return false;

  if (p === "/objectives" && method === "GET") {
    const all = await listObjectives(cfg);
    json(res, 200, { objectives: all.map(summarize), count: all.length });
    return true;
  }

  if (p === "/objectives" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const objective = String(body?.objective || "").trim();
    if (!objective) {
      json(res, 400, { error: "objective required" });
      return true;
    }
    // create synchronously so the caller gets the id
    const store = await import("../../agent/objective-store.mjs");
    const obj = store.newObjective({ objective, channel: "api", chatId: null, workingDir: body?.workingDir || null, verify: Array.isArray(body?.verify) ? body.verify : null });
    await saveObjective(cfg, obj);
    await startGatewayObjective(cfg, { resumeId: obj.id }, { workingDir: body?.workingDir });
    json(res, 200, { ok: true, id: obj.id, status: "running" });
    return true;
  }

  const m = p.match(/^\/objectives\/([A-Za-z0-9_-]+)(?:\/(stop|resume))?$/);
  if (!m) {
    json(res, 404, { error: "not found", path: p });
    return true;
  }
  const [, id, action] = m;
  const obj = await loadObjective(cfg, id);
  if (!obj) {
    json(res, 404, { error: "objective not found", id });
    return true;
  }

  if (!action && method === "GET") {
    json(res, 200, obj);
    return true;
  }
  if (action === "stop" && method === "POST") {
    obj.stopRequested = true;
    await saveObjective(cfg, obj);
    json(res, 200, { ok: true, id, status: obj.status, stopRequested: true });
    return true;
  }
  if (action === "resume" && method === "POST") {
    if (obj.status === "running") {
      json(res, 409, { error: "already running", id });
      return true;
    }
    if (isTerminalObjective(obj.status) && obj.status !== "stopped") {
      json(res, 409, { error: `objective is ${obj.status}`, id });
      return true;
    }
    const body = await readBody(req).catch(() => ({}));
    await startGatewayObjective(
      cfg,
      { resumeId: id, ...(body?.answer ? { answer: String(body.answer) } : {}) },
      { workingDir: obj.workingDir }
    );
    json(res, 200, { ok: true, id, status: "running" });
    return true;
  }
  json(res, 405, { error: "method not allowed" });
  return true;
}
