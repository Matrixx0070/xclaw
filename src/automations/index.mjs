/**
 * XClaw Automations — schedule a prompt, list/pause/resume, keep results.
 *
 * Thin product layer over cron scheduler + agent runner.
 */
import { randomUUID } from "node:crypto";
import { loadStore, saveStore, automationsPath } from "./store.mjs";
import {
  DEFAULT_MAX_TICKS,
  initialGoalState,
  buildGoalPrompt,
  parseGoalState,
  applyGoalTick,
} from "./goal.mjs";
import {
  addJob,
  updateJob,
  cancelJob,
  getJob,
  listJobs,
  run as runCronJob,
  start as startCron,
} from "../cron/scheduler.mjs";

function parseSchedule(input = {}) {
  if (input.everyMs || input.intervalMs) {
    return { kind: "every", everyMs: Number(input.everyMs || input.intervalMs) };
  }
  if (input.at) {
    return { kind: "at", at: String(input.at) };
  }
  if (input.cron) {
    return { kind: "cron", expr: String(input.cron) };
  }
  if (input.schedule && typeof input.schedule === "object") {
    return input.schedule;
  }
  // default: every hour
  return { kind: "every", everyMs: 3_600_000 };
}

/**
 * Create automation.
 * @param {object} cfg
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} [opts.name]
 * @param {string} [opts.cron]  5-field cron
 * @param {number} [opts.everyMs]
 * @param {string} [opts.at] ISO time
 * @param {boolean} [opts.enabled]
 * @param {string} [opts.mode] "prompt" (default) or "goal" — goal mode keeps
 *   persistent plan/progress state and re-plans every tick until done/maxTicks.
 * @param {number} [opts.maxTicks] goal mode only (default 20)
 */
export function createAutomation(cfg, opts = {}) {
  const mode = opts.mode === "goal" ? "goal" : "prompt";
  const prompt = String(opts.prompt || opts.message || opts.goal || "").trim();
  if (!prompt) {
    return { ok: false, error: mode === "goal" ? "goal_required" : "prompt_required" };
  }
  const id = opts.id || randomUUID();
  const schedule = parseSchedule(opts);
  const name = opts.name || `auto-${prompt.slice(0, 32).replace(/\s+/g, "-")}`;

  const store = loadStore(cfg);
  const record = {
    id,
    name,
    mode,
    prompt,
    schedule,
    enabled: opts.enabled !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunAt: null,
    lastStatus: null,
  };
  if (mode === "goal") {
    record.goal = String(opts.goal || prompt).trim();
    const mt = Number(opts.maxTicks);
    record.maxTicks =
      Number.isFinite(mt) && mt > 0 ? Math.floor(mt) : DEFAULT_MAX_TICKS;
    record.state = initialGoalState();
  }
  store.automations = store.automations.filter((a) => a.id !== id);
  store.automations.push(record);
  saveStore(cfg, store);

  // Wire into in-process cron
  registerAutomationJob(cfg, record);
  return { ok: true, automation: record };
}

function registerAutomationJob(cfg, record) {
  // remove old job if any
  try {
    cancelJob(record.id);
  } catch {
    /* */
  }
  if (!record.enabled) return null;

  return addJob({
    id: record.id,
    name: `automation:${record.name}`,
    enabled: true,
    schedule: record.schedule,
    cfg,
    payload: {
      kind: "agentTurn",
      prompt: record.prompt,
      message: record.prompt,
      text: record.prompt,
      automationId: record.id,
    },
    handler: async (job) => {
      await executeAutomation(cfg, record.id, { mode: "scheduled" });
    },
  });
}

/**
 * Run agent turn for an automation and append result.
 */
export async function executeAutomation(cfg, id, { mode = "manual", runner = null } = {}) {
  const store = loadStore(cfg);
  const auto = store.automations.find((a) => a.id === id);
  if (!auto) return { ok: false, error: "not_found" };

  const startedAt = new Date().toISOString();
  let status = "ok";
  let summary = "";
  let error = null;
  let goalTick = null;

  try {
    // Prefer lightweight agent runner if available (injectable for tests)
    const runAgentOnce =
      runner ||
      (await import("../agent/run-once.mjs").catch(() => ({}))).runAgentOnce;
    if (typeof runAgentOnce === "function") {
      const isGoal = auto.mode === "goal";
      const message = isGoal ? buildGoalPrompt(auto) : auto.prompt;
      const out = await runAgentOnce({
        cfg,
        message,
        goal: auto.prompt,
        source: "automation",
        automationId: id,
      });
      summary =
        typeof out === "string"
          ? out.slice(0, 2000)
          : JSON.stringify(out?.text || out?.reply || out || {}).slice(0, 2000);
      if (out?.ok === false) {
        status = "error";
        error = out.error || "agent_failed";
      } else if (isGoal) {
        // Fold the tick into persistent goal state; stop when done/exhausted
        const parsed = parseGoalState(typeof out === "string" ? out : out?.text);
        goalTick = applyGoalTick(auto, parsed);
        auto.state = goalTick.state;
        const note = goalTick.state.progress.slice(-1)[0] || "";
        summary = `[tick ${goalTick.state.tick}${
          goalTick.finished ? ` · finished:${goalTick.reason}` : ""
        }] ${note}`.slice(0, 2000);
        if (goalTick.finished) {
          auto.enabled = false;
          try {
            cancelJob(auto.id);
          } catch {
            /* not scheduled in this process */
          }
        }
      }
    } else {
      // Fallback: emit via announce path / mark scheduled
      const { announceCronJob } = await import("../cron/announce.mjs");
      const ann = await announceCronJob(
        {
          id,
          name: auto.name,
          payload: { message: auto.prompt, text: auto.prompt, prompt: auto.prompt },
          _cfg: cfg,
        },
        { cfg }
      );
      summary = JSON.stringify(ann || { note: "announced" }).slice(0, 2000);
    }
  } catch (e) {
    status = "error";
    error = e.message || String(e);
    summary = error;
  }

  const result = {
    id: randomUUID(),
    automationId: id,
    name: auto.name,
    mode,
    status,
    summary,
    error,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  if (goalTick) {
    result.tick = goalTick.state.tick;
    result.goalFinished = goalTick.finished;
    result.goalReason = goalTick.reason;
  }

  store.results.push(result);
  auto.lastRunAt = result.finishedAt;
  auto.lastStatus = status;
  auto.updatedAt = result.finishedAt;
  saveStore(cfg, store);
  return { ok: status === "ok", result, automation: auto };
}

export function listAutomations(cfg, { includeDisabled = true } = {}) {
  const store = loadStore(cfg);
  return store.automations.filter((a) => includeDisabled || a.enabled);
}

export function getAutomation(cfg, id) {
  return listAutomations(cfg, { includeDisabled: true }).find((a) => a.id === id) || null;
}

export function setEnabled(cfg, id, enabled) {
  const store = loadStore(cfg);
  const auto = store.automations.find((a) => a.id === id);
  if (!auto) return { ok: false, error: "not_found" };
  auto.enabled = Boolean(enabled);
  auto.updatedAt = new Date().toISOString();
  saveStore(cfg, store);
  if (auto.enabled) {
    registerAutomationJob(cfg, auto);
  } else {
    try {
      updateJob(id, { enabled: false });
    } catch {
      cancelJob(id);
    }
  }
  return { ok: true, automation: auto };
}

export function deleteAutomation(cfg, id) {
  const store = loadStore(cfg);
  const before = store.automations.length;
  store.automations = store.automations.filter((a) => a.id !== id);
  saveStore(cfg, store);
  try {
    cancelJob(id);
  } catch {
    /* */
  }
  return { ok: true, removed: before !== store.automations.length };
}

export function listResults(cfg, { automationId = null, limit = 10 } = {}) {
  const store = loadStore(cfg);
  let rows = store.results || [];
  if (automationId) rows = rows.filter((r) => r.automationId === automationId);
  return rows.slice(-Math.max(1, limit)).reverse();
}

/**
 * Re-register all enabled automations into the process cron (gateway start).
 */
export function hydrateAutomations(cfg) {
  try {
    startCron?.();
  } catch {
    /* start may not exist */
  }
  const list = listAutomations(cfg, { includeDisabled: false });
  for (const a of list) {
    registerAutomationJob(cfg, a);
  }
  return { ok: true, count: list.length, path: automationsPath(cfg) };
}

export default {
  createAutomation,
  executeAutomation,
  listAutomations,
  getAutomation,
  setEnabled,
  deleteAutomation,
  listResults,
  hydrateAutomations,
};
