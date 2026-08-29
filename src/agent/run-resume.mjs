/**
 * Crash/restart recovery for durable agent-run snapshots.
 *
 * Feature 2 wrote ~/.xclaw/agent-runs/*.json so a gateway restart could
 * continue work. v3.376.0 made the default path actually WRITE those
 * snapshots. Nothing on boot ever READ them: missions get marked
 * resumable, objectives get auto-resumed, agent-runs sat on disk.
 *
 * This module classifies a snapshot as resumable, stamps it interrupted,
 * then promotes it into the EXISTING objective orchestrator (fresh
 * segment, durable state, "verify before rewrite"). It does not invent a
 * second persistence system and does not auto-run killed/approval/budget
 * stops — those stay put for a human.
 */
import { loadAgentRun, saveAgentRun, runsDir } from "./run-store.mjs";
import fs from "node:fs/promises";

const NOTICE_RE = /^\[XClaw notice\]/;
const DEFAULT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MAX = 3;

const STAY_PUT = new Set([
  "aborted",
  "approval",
  "budget",
  "policy",
  "guard",
  "completed",
  "hook",
  "resumed",
  "natural",
]);

/**
 * Pure: whether a snapshot is unfinished work that a restart should
 * continue. Kill, pending approval, budget, policy, and natural
 * completion are NOT resumable.
 *
 * @param {object} run
 * @param {{ now?: number, maxAgeMs?: number }} [opts]
 */
export function isResumableAgentRun(run = {}, opts = {}) {
  if (!run || typeof run !== "object") return false;
  if (run.resumedAt || run.objectiveId) return false;
  if (run.stopRequested) return false;
  const status = String(run.status || "");
  const reason = String(run.stopReason || "");
  if (STAY_PUT.has(status) || STAY_PUT.has(reason)) return false;
  const maxAgeMs =
    Number.isFinite(Number(opts.maxAgeMs)) && Number(opts.maxAgeMs) > 0
      ? Number(opts.maxAgeMs)
      : DEFAULT_MAX_AGE_MS;
  const now = Number.isFinite(Number(opts.now)) ? Number(opts.now) : Date.now();
  if (run.updatedAt) {
    const t = Date.parse(run.updatedAt);
    if (Number.isFinite(t) && now - t > maxAgeMs) return false;
  }
  if (status === "active" || status === "interrupted" || status === "maxTurns") return true;
  if (reason === "maxTurns" || reason === "segment") return true;
  return false;
}

/**
 * Goal text to seed the recovered objective. Prefer the snapshot's
 * recorded goal; skip runtime notices so a segment checkpoint does not
 * become the mission statement.
 */
export function goalFromAgentRun(run = {}) {
  const metaGoal = String(run.meta?.goal || "").trim();
  if (metaGoal && !NOTICE_RE.test(metaGoal)) return metaGoal.slice(0, 500);
  const messages = Array.isArray(run.messages) ? run.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const text = typeof m.content === "string" ? m.content.trim() : "";
    if (!text || NOTICE_RE.test(text)) continue;
    return text.slice(0, 500);
  }
  return "";
}

function artifactFiles(run = {}) {
  const files = [];
  for (const t of run.toolTrace || []) {
    for (const a of t.artifacts || []) {
      if (a?.type === "file" && typeof a.ref === "string" && !files.includes(a.ref)) {
        files.push(a.ref);
      }
    }
  }
  return files.slice(0, 100);
}

function lastAssistantText(run = {}) {
  const messages = Array.isArray(run.messages) ? run.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && typeof m.content === "string" && m.content.trim()) {
      return m.content.trim();
    }
  }
  return "";
}

/**
 * Scan the run store and return full resumable snapshots (newest first).
 * listAgentRuns is a 30-row operator summary; boot needs the bodies.
 */
export async function listResumableAgentRuns(cfg, opts = {}) {
  const dir = runsDir(cfg);
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json") && !f.endsWith(".bad.json"));
  } catch {
    return [];
  }
  names.sort().reverse();
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 80;
  const out = [];
  for (const f of names.slice(0, limit)) {
    const id = f.replace(/\.json$/, "");
    const loaded = await loadAgentRun(cfg, id);
    if (!loaded.ok) continue;
    if (isResumableAgentRun(loaded.run, opts)) out.push(loaded.run);
  }
  return out;
}

/**
 * Active (crash mid-segment) snapshots become interrupted so a second
 * boot can tell "was running when we died" from a brand-new run.
 * Returns the sessionIds stamped.
 */
export async function reconcileInterruptedAgentRuns(cfg, opts = {}) {
  const dir = runsDir(cfg);
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const touched = [];
  for (const f of names) {
    const id = f.replace(/\.json$/, "");
    const loaded = await loadAgentRun(cfg, id);
    if (!loaded.ok) continue;
    const run = loaded.run;
    if (run.status !== "active") continue;
    if (run.resumedAt || run.objectiveId) continue;
    run.status = "interrupted";
    await saveAgentRun(cfg, run);
    touched.push(run.sessionId);
  }
  return touched;
}

/**
 * Promote one interrupted snapshot into a durable objective and start it.
 * `start` is injected so tests do not spawn a live agent loop.
 *
 * @param {object} cfg
 * @param {object} run
 * @param {{ start?: (obj: object) => Promise<unknown> }} [opts]
 */
export async function resumeAgentRunAsObjective(cfg, run, opts = {}) {
  if (!isResumableAgentRun(run, opts)) {
    return { ok: false, reason: "not_resumable", sessionId: run?.sessionId || null };
  }
  const goal = goalFromAgentRun(run);
  if (!goal) {
    return { ok: false, reason: "no_goal", sessionId: run.sessionId };
  }
  const store = await import("./objective-store.mjs");
  const sessionKey = run.meta?.sessionKey || `agent-run:${run.sessionId}`;
  const existing = await store.findActiveObjective(cfg, {
    sessionKey,
    channel: run.meta?.channel || "resume",
    chatId: run.sessionId,
  });
  if (existing) {
    await saveAgentRun(cfg, {
      ...run,
      status: "resumed",
      resumedAt: new Date().toISOString(),
      objectiveId: existing.id,
    });
    return {
      ok: true,
      sessionId: run.sessionId,
      objectiveId: existing.id,
      already: true,
    };
  }
  const obj = store.newObjective({
    objective: goal,
    sessionKey,
    channel: run.meta?.channel || "resume",
    chatId: run.sessionId,
    workingDir: run.workingDir || null,
  });
  store.mergeStateUpdate(obj, {
    progress: [
      `Recovered after process restart. Prior run \`${run.sessionId}\` stopped (${run.status}/${run.stopReason || "n/a"}) at turn ${run.turns ?? "?"}.`,
      "Partial work may already exist on disk — verify before rewriting.",
    ],
    findings: lastAssistantText(run) ? [lastAssistantText(run).slice(0, 800)] : [],
    inspected: { files: artifactFiles(run) },
  });
  obj.inFlightSegment = {
    n: Number(run.turns) || 1,
    at: run.updatedAt || new Date().toISOString(),
  };
  await store.saveObjective(cfg, obj);
  await saveAgentRun(cfg, {
    ...run,
    status: "resumed",
    resumedAt: new Date().toISOString(),
    objectiveId: obj.id,
  });
  if (typeof opts.start === "function") {
    await opts.start(obj);
  }
  return { ok: true, sessionId: run.sessionId, objectiveId: obj.id };
}

/**
 * Boot path: stamp active → interrupted, then auto-start a bounded number
 * of recovered objectives. No-op when objectives are disabled or
 * agent.autoResume is false.
 */
export async function reconcileAndResumeAgentRuns(cfg, opts = {}) {
  const touched = await reconcileInterruptedAgentRuns(cfg, opts);
  if (cfg?.objectives?.enabled === false) {
    return { touched, resumed: [], skipped: "objectives_disabled" };
  }
  if (cfg?.agent?.autoResume === false) {
    return { touched, resumed: [], skipped: "autoResume_false" };
  }
  const max =
    Number(opts.max) > 0
      ? Number(opts.max)
      : Number(cfg?.agent?.autoResumeMax) > 0
        ? Number(cfg.agent.autoResumeMax)
        : Number(cfg?.objectives?.autoResumeMax) > 0
          ? Number(cfg.objectives.autoResumeMax)
          : DEFAULT_MAX;
  const maxAgeMs =
    Number(cfg?.agent?.autoResumeMaxAgeMs) > 0
      ? Number(cfg.agent.autoResumeMaxAgeMs)
      : DEFAULT_MAX_AGE_MS;
  const candidates = await listResumableAgentRuns(cfg, { ...opts, maxAgeMs });
  const resumed = [];
  for (const run of candidates) {
    if (resumed.length >= max) break;
    const out = await resumeAgentRunAsObjective(cfg, run, opts);
    if (out.ok && !out.already) resumed.push(out);
  }
  return { touched, resumed, skipped: null };
}

export { DEFAULT_MAX_AGE_MS, DEFAULT_MAX };
