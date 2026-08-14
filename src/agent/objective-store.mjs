/**
 * Durable objective (mission) state — the memory that survives execution
 * boundaries.
 *
 * Root cause this exists for (traced 2026-08-14): a high-level objective
 * given over a channel ran as ONE runAgentLoop call. maxTurns (15) ended the
 * run after ~20–30 tool calls; the rescue text asked the user "should I
 * continue?"; across turns the objective itself rolled out of the
 * 40-message history cap. Raw transcripts were the only cross-turn memory.
 *
 * This store keeps the mission — objective, interpretation, plan, completion
 * criteria, progress, findings, decisions, failures, inspected resources —
 * in an atomic per-objective JSON under ~/.xclaw/objectives/. The model
 * updates it via fenced state blocks each segment; the runtime OWNS it.
 *
 * Storage conventions match missions/store.mjs: atomic write via tmp+rename,
 * ID_RE guard against path traversal, reconcileInterrupted at boot.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const ID_RE = /^[a-zA-Z0-9_-]+$/;

export const OBJECTIVE_STATUSES = [
  "running",
  "awaiting_human",
  "paused_budget",
  "interrupted",
  "done",
  "failed",
  "stopped",
];

const TERMINAL = new Set(["done", "failed", "stopped"]);

export function objectivesDir(cfg = {}) {
  return (
    cfg.objectives?.dir ||
    path.join(cfg.paths?.configDir || path.join(os.homedir(), ".xclaw"), "objectives")
  );
}

function fileFor(cfg, id) {
  if (!ID_RE.test(String(id || ""))) throw new Error(`invalid objective id: ${id}`);
  return path.join(objectivesDir(cfg), `${id}.json`);
}

/** Bounded string-array union — newest survive, dedup, per-item cap. */
function unionCapped(base = [], add = [], { max = 200, itemMax = 500 } = {}) {
  const seen = new Set();
  const out = [];
  for (const v of [...base, ...add]) {
    const s = String(v ?? "").slice(0, itemMax).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.slice(-max);
}

export function newObjective({
  objective,
  sessionKey = null,
  channel = null,
  chatId = null,
  workingDir = null,
} = {}) {
  const now = new Date().toISOString();
  return {
    v: 1,
    id: `obj_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    status: "running",
    objective: String(objective || "").slice(0, 8000),
    interpretation: "",
    criteria: [], // [{ id, text, done, evidence }]
    plan: [], // [string]
    currentSubtask: "",
    remaining: [],
    progress: [], // compact accomplished-work notes
    findings: [], // important discoveries
    decisions: [], // decisions already made (do not re-litigate)
    constraints: [],
    openQuestions: [],
    failures: [], // [{ at, what, error, recovery }]
    inspected: { files: [], dirs: [], components: [] },
    humanQuestion: null,
    stopRequested: false,
    sessionKey,
    channel,
    chatId,
    workingDir,
    segments: [], // [{ n, turns, toolCalls, stopReason, status, at }]
    totals: { segments: 0, toolCalls: 0, turns: 0 },
    finalAnswer: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveObjective(cfg, obj) {
  const dir = objectivesDir(cfg);
  await fs.mkdir(dir, { recursive: true });
  const fp = fileFor(cfg, obj.id);
  const tmp = `${fp}.tmp-${process.pid}`;
  obj.updatedAt = new Date().toISOString();
  await fs.writeFile(tmp, JSON.stringify(obj, null, 1));
  await fs.rename(tmp, fp);
  return obj;
}

export async function loadObjective(cfg, id) {
  try {
    return JSON.parse(await fs.readFile(fileFor(cfg, id), "utf8"));
  } catch {
    return null;
  }
}

export async function listObjectives(cfg, { activeOnly = false } = {}) {
  let names = [];
  try {
    names = await fs.readdir(objectivesDir(cfg));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const o = JSON.parse(await fs.readFile(path.join(objectivesDir(cfg), n), "utf8"));
      if (activeOnly && TERMINAL.has(o.status)) continue;
      out.push(o);
    } catch {
      /* skip corrupt */
    }
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

/** Newest non-terminal objective bound to a channel session, if any. */
export async function findActiveObjective(cfg, { sessionKey, channel, chatId } = {}) {
  const all = await listObjectives(cfg, { activeOnly: true });
  return (
    all.find(
      (o) =>
        (sessionKey && o.sessionKey === sessionKey) ||
        (channel && chatId && o.channel === channel && String(o.chatId) === String(chatId))
    ) || null
  );
}

/**
 * Merge a model-emitted state update into the durable objective.
 * The ORIGINAL objective text is never overwritten. Arrays union with caps;
 * criteria merge by id (text fallback); done flags are sticky true.
 */
export function mergeStateUpdate(obj, update = {}) {
  if (!update || typeof update !== "object") return obj;
  if (typeof update.interpretation === "string" && update.interpretation.trim()) {
    obj.interpretation = update.interpretation.slice(0, 2000);
  }
  if (Array.isArray(update.criteria)) {
    const byKey = new Map(obj.criteria.map((c) => [c.id || c.text, c]));
    for (const raw of update.criteria.slice(0, 40)) {
      const c =
        typeof raw === "string"
          ? { id: null, text: raw, done: false, evidence: null }
          : {
              id: raw.id != null ? String(raw.id).slice(0, 60) : null,
              text: String(raw.text || "").slice(0, 300),
              done: raw.done === true,
              evidence: raw.evidence ? String(raw.evidence).slice(0, 300) : null,
            };
      if (!c.text) continue;
      const key = c.id || c.text;
      const prev = byKey.get(key);
      if (prev) {
        prev.done = prev.done || c.done; // sticky
        if (c.evidence) prev.evidence = c.evidence;
      } else {
        byKey.set(key, c);
      }
    }
    obj.criteria = [...byKey.values()].slice(0, 60);
  }
  if (Array.isArray(update.plan)) obj.plan = unionCapped([], update.plan, { max: 40 });
  if (typeof update.currentSubtask === "string") {
    obj.currentSubtask = update.currentSubtask.slice(0, 400);
  }
  obj.remaining = Array.isArray(update.remaining)
    ? unionCapped([], update.remaining, { max: 60 })
    : obj.remaining;
  obj.progress = unionCapped(obj.progress, update.progress || [], { max: 120 });
  obj.findings = unionCapped(obj.findings, update.findings || [], { max: 120 });
  obj.decisions = unionCapped(obj.decisions, update.decisions || [], { max: 60 });
  obj.constraints = unionCapped(obj.constraints, update.constraints || [], { max: 30 });
  obj.openQuestions = Array.isArray(update.openQuestions)
    ? unionCapped([], update.openQuestions, { max: 30 })
    : obj.openQuestions;
  if (update.inspected && typeof update.inspected === "object") {
    for (const k of ["files", "dirs", "components"]) {
      obj.inspected[k] = unionCapped(obj.inspected[k], update.inspected[k] || [], {
        max: 400,
        itemMax: 300,
      });
    }
  }
  if (Array.isArray(update.failures)) {
    for (const f of update.failures.slice(0, 10)) {
      obj.failures.push({
        at: new Date().toISOString(),
        what: String(f.what || f).slice(0, 300),
        error: f.error ? String(f.error).slice(0, 300) : null,
        recovery: f.recovery ? String(f.recovery).slice(0, 300) : null,
      });
    }
    obj.failures = obj.failures.slice(-40);
  }
  return obj;
}

/** Boot reconcile: objectives left "running" by a dead gateway → interrupted. */
export async function reconcileInterruptedObjectives(cfg) {
  const all = await listObjectives(cfg, { activeOnly: true });
  const touched = [];
  for (const o of all) {
    if (o.status === "running") {
      o.status = "interrupted";
      await saveObjective(cfg, o);
      touched.push(o.id);
    }
  }
  return touched;
}

export function isTerminalObjective(status) {
  return TERMINAL.has(status);
}
