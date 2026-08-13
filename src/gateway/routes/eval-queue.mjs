/**
 * Gateway eval + queue + jobs HTTP routes (extracted from index.mjs).
 *
 * Paths:
 *   GET  /eval/scoreboard · /eval/spend · /eval/history · /eval/baseline
 *   GET  /queue/stats · /queue/admission · /queue/dead · /queue · /queue/:id
 *   POST /queue · /queue/retry-failed · /queue/clear · /queue/:id/cancel
 *        /queue/pause · /queue/resume
 *   GET  /cron/eval · POST /cron/eval/run
 *   GET  /jobs · /jobs/:id · POST /jobs
 *   GET  /skills/proposals · /skills/stats
 *
 * NOTE: the original inline POST /queue handler carried a pasted copy of
 * gateway-startup code that registered a NEW approval-digest setInterval on
 * every enqueue (interval leak) — dropped here; startQueueWorker (idempotent
 * worker ensure) is kept.
 */

/**
 * @param {object} args — standard route args + root
 * @returns {Promise<boolean>} true if handled
 */
export async function tryHandleEvalQueueRoute({
  p,
  method,
  req,
  res,
  url,
  cfg,
  json,
  readBody,
  root,
}) {
  if (p === "/eval/scoreboard" && method === "GET") {
    const { buildScoreboard } = await import("../../eval/scoreboard.mjs");
    json(res, 200, await buildScoreboard(cfg, { root }));
    return true;
  }
  if (p === "/eval/spend" && method === "GET") {
    const { summarizeEvalSpend } = await import("../../eval/spend.mjs");
    json(res, 200, await summarizeEvalSpend(cfg, {
      limit: Number(url.searchParams.get("limit") || 100),
    }));
    return true;
  }
  if (p === "/eval/history" && method === "GET") {
    const { listEvalHistory } = await import("../../eval/history.mjs");
    const items = await listEvalHistory(cfg, { limit: Number(url.searchParams.get("limit") || 30) });
    json(res, 200, { history: items, count: items.length });
    return true;
  }
  if (p === "/eval/baseline" && method === "GET") {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const fp = path.join(root, "eval", "baselines", "main.json");
      const raw = await fs.readFile(fp, "utf8");
      json(res, 200, JSON.parse(raw));
    } catch (err) {
      json(res, 404, { error: "baseline not found", detail: err.message });
    }
    return true;
  }

  if (p === "/queue/stats" && method === "GET") {
    const { queueStats } = await import("../../jobs/queue.mjs");
    json(res, 200, await queueStats(cfg));
    return true;
  }
  if (p === "/queue/admission" && method === "GET") {
    const { getDefaultAdmission, qedStaffing } = await import("../../utils/admission.mjs");
    const adm = getDefaultAdmission(cfg);
    const q = cfg.queue || {};
    const a = Number(url.searchParams.get("a"));
    const beta = Number(url.searchParams.get("beta") || 1);
    const arrivals = Number(url.searchParams.get("arrivalsPerSec"));
    const meanS = Number(url.searchParams.get("meanServiceSec"));
    let suggest = null;
    if (Number.isFinite(arrivals) && Number.isFinite(meanS)) {
      suggest = adm.suggestConcurrency({ arrivalsPerSec: arrivals, meanServiceSec: meanS, beta });
    } else if (Number.isFinite(a)) {
      suggest = { a, beta, suggested: qedStaffing(a, beta), current: adm.concurrency };
    }
    json(res, 200, {
      ok: true,
      policy: {
        concurrency: q.concurrency ?? adm.concurrency,
        maxDepth: q.maxDepth ?? adm.maxDepth,
        maxWaitMs: q.maxWaitMs ?? adm.maxWaitMs,
        maxConcurrencyCap: q.maxConcurrencyCap ?? 16,
      },
      metrics: adm.snapshot().metrics,
      suggest,
    });
    return true;
  }
  if (p === "/queue/dead" && method === "GET") {
    const { listDeadLetter } = await import("../../jobs/queue.mjs");
    const items = await listDeadLetter(cfg, { limit: Number(url.searchParams.get("limit") || 50) });
    json(res, 200, { deadLetter: items, count: items.length });
    return true;
  }
  if (p === "/queue" && method === "GET") {
    const { listQueue, queueStatus, queueStats } = await import("../../jobs/queue.mjs");
    const items = await listQueue(cfg, { limit: Number(url.searchParams.get("limit") || 50) });
    const stats = await queueStats(cfg);
    json(res, 200, { queue: items, count: items.length, worker: queueStatus(cfg), stats });
    return true;
  }
  if (p === "/queue/retry-failed" && method === "POST") {
    const { retryFailedQueue } = await import("../../jobs/queue.mjs");
    json(res, 200, await retryFailedQueue(cfg));
    return true;
  }
  if (p === "/queue/clear" && method === "POST") {
    const { clearCompletedQueue } = await import("../../jobs/queue.mjs");
    json(res, 200, await clearCompletedQueue(cfg));
    return true;
  }
  if (p.startsWith("/queue/") && p.endsWith("/cancel") && method === "POST") {
    const { cancelQueueItem } = await import("../../jobs/queue.mjs");
    const id = p.slice("/queue/".length, -"/cancel".length);
    const item = await cancelQueueItem(cfg, id);
    if (!item) {
      json(res, 404, { error: "not found" });
      return true;
    }
    json(res, 200, item);
    return true;
  }
  if (p === "/queue/pause" && method === "POST") {
    const { pauseQueue } = await import("../../jobs/queue.mjs");
    json(res, 200, pauseQueue());
    return true;
  }
  if (p === "/queue/resume" && method === "POST") {
    const { resumeQueue } = await import("../../jobs/queue.mjs");
    json(res, 200, resumeQueue(cfg));
    return true;
  }
  if (p === "/queue" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const { enqueueJob, startQueueWorker } = await import("../../jobs/queue.mjs");
    startQueueWorker(cfg);
    const item = await enqueueJob(cfg, {
      goal: body.goal || body.message,
      verify: body.verify || [],
      maxTurns: body.maxTurns,
      priority: body.priority,
    });
    json(res, 202, item);
    return true;
  }
  if (p.startsWith("/queue/") && method === "GET") {
    const { getQueueItem } = await import("../../jobs/queue.mjs");
    const id = p.slice("/queue/".length).split("/")[0];
    const item = await getQueueItem(cfg, id);
    if (!item) {
      json(res, 404, { error: "not found" });
      return true;
    }
    json(res, 200, item);
    return true;
  }
  if (p === "/cron/eval" && method === "GET") {
    const { evalCronStatus } = await import("../../cron/eval-job.mjs");
    json(res, 200, evalCronStatus());
    return true;
  }
  if (p === "/cron/eval/run" && method === "POST") {
    const { runScheduledEval } = await import("../../cron/eval-job.mjs");
    const body = await readBody(req).catch(() => ({}));
    // async fire for long suite — but await for correctness in v1
    const out = await runScheduledEval({ cfg, tag: body.tag, writeBaseline: body.writeBaseline !== false });
    json(res, out.ok ? 200 : 422, out);
    return true;
  }

  if (p === "/jobs" && method === "GET") {
    const { listJobs } = await import("../../jobs/history.mjs");
    const limit = Number(url.searchParams.get("limit") || 30);
    const items = await listJobs(cfg, { limit });
    json(res, 200, { jobs: items, count: items.length });
    return true;
  }
  if (p.startsWith("/jobs/") && method === "GET") {
    const { getJob } = await import("../../jobs/history.mjs");
    const id = p.slice("/jobs/".length).split("/")[0];
    const job = await getJob(cfg, id);
    if (!job) {
      json(res, 404, { error: "job not found" });
      return true;
    }
    json(res, 200, job);
    return true;
  }
  if (p === "/skills/proposals" && method === "GET") {
    const { listProposals } = await import("../../skills/propose.mjs");
    const items = await listProposals(cfg, Number(url.searchParams.get("limit") || 20));
    json(res, 200, { proposals: items, count: items.length });
    return true;
  }
  if (p === "/skills/proposals/decide" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const file = String(body.file || "");
    // proposal filenames only — the propose-store helpers join relative names
    // onto the proposals dir, so separators/.. would escape it
    if (!file || /[/\\]/.test(file) || file.includes("..")) {
      json(res, 400, { error: "file must be a proposal filename" });
      return true;
    }
    try {
      if (body.action === "install") {
        const { installProposal } = await import("../../skills/propose.mjs");
        json(res, 200, { ok: true, installed: await installProposal(cfg, file, { force: Boolean(body.force) }) });
      } else if (body.action === "reject") {
        const { rejectProposal } = await import("../../skills/propose.mjs");
        json(res, 200, { ok: true, rejected: await rejectProposal(cfg, file, String(body.reason || "")) });
      } else {
        json(res, 400, { error: "action must be install or reject" });
      }
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
    return true;
  }
  if (p === "/skills/stats" && method === "GET") {
    const { loadSkillStats } = await import("../../skills/registry.mjs");
    json(res, 200, await loadSkillStats(cfg));
    return true;
  }

  if (p === "/jobs" && method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const goal = body.goal || body.message || body.prompt;
    if (!goal) {
      json(res, 400, { error: "goal required" });
      return true;
    }
    const { runJob, saveJobSummary } = await import("../../jobs/job.mjs");
    const job = await runJob({
      goal,
      cfg,
      workspace: body.workspace,
      verify: body.verify || [],
      maxTurns: body.maxTurns || cfg.agent?.maxTurns || 12,
      timeoutMs: body.timeoutMs || 180000,
      autoApprove: body.autoApprove,
    });
    await saveJobSummary(job).catch(() => {});
    json(res, job.pass ? 200 : 422, {
      id: job.id,
      status: job.status,
      pass: job.pass,
      turns: job.turns,
      toolCalls: job.toolCalls,
      wallMs: job.wallMs,
      text: job.text,
      verify: job.verify,
      evidence: job.evidence,
      error: job.error,
    });
    return true;
  }

  return false;
}

export default { tryHandleEvalQueueRoute };
