/**
 * Mission store — durable state for autonomous engineering missions.
 * One JSON file per mission under <configDir>/missions/, written atomically
 * (tmp + rename) after every transition so a crash/restart never loses more
 * than the in-flight step. Event log is bounded.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const ACTIVE_STATUSES = new Set([
  "planning",
  "executing",
  "verifying",
  "repairing",
  "merging",
]);
export const MISSION_STATUSES = [
  "planning",
  "executing",
  "verifying",
  "repairing",
  "merge_ready",
  "merging",
  "done",
  "failed",
  "rolled_back",
  "interrupted",
  // A4 self-modification profile only — deploy lifecycle owned by the
  // external self-deploy watcher, not the gateway
  "deploying",
  "deployed",
  "deploy_rolled_back",
];

function missionsDir(cfg = {}) {
  const dir = cfg.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(dir, "missions");
}

// Mission ids are minted as msn_<base36>_<uuid8>; anything with path
// separators / traversal / odd chars is rejected so a crafted id can never
// escape the missions dir (found by adversarial probe: /missions/..%2Fx
// read arbitrary .json under the config dir, e.g. credentials.json).
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
function fileFor(cfg, id) {
  const s = String(id);
  if (!ID_RE.test(s)) throw new Error("invalid mission id");
  return path.join(missionsDir(cfg), `${s}.json`);
}

export async function saveMission(cfg, mission) {
  mission.updatedAt = new Date().toISOString();
  const fp = fileFor(cfg, mission.id);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  const tmp = fp + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(mission, null, 2));
  await fs.rename(tmp, fp);
  return mission;
}

export async function loadMission(cfg, id) {
  try {
    return JSON.parse(await fs.readFile(fileFor(cfg, String(id)), "utf8"));
  } catch {
    return null;
  }
}

export async function listMissions(cfg, { limit = 50, status } = {}) {
  let names;
  try {
    names = (await fs.readdir(missionsDir(cfg))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      const m = JSON.parse(await fs.readFile(path.join(missionsDir(cfg), n), "utf8"));
      if (status && m.status !== status) continue;
      out.push(m);
    } catch {
      /* corrupt entry — skip, never break the listing */
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out.slice(0, limit);
}

export function newMission({ goal, repoDir, maxAttempts = 3, autoMerge = false, verify = null }) {
  const now = new Date().toISOString();
  return {
    id: `msn_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    goal: String(goal),
    repoDir: String(repoDir),
    status: "planning",
    createdAt: now,
    updatedAt: now,
    autoMerge: Boolean(autoMerge),
    maxAttempts,
    attempts: 0,
    worktree: null, // {path, branch}
    plan: null, // {summary, contextFiles}
    executedAt: null, // set when the execute phase completes (phase-aware resume)
    verify: { commands: verify, results: [], history: [] },
    diff: null, // {stat, patch}
    agentRuns: [], // {phase, turns, ms, at}
    events: [], // bounded {at, phase, note}
    error: null,
    mergedAt: null,
  };
}

/** Statuses that are final — a late/aborted handler must never overwrite them. */
export const TERMINAL_STATUSES = new Set([
  "done",
  "rolled_back",
  "deployed",
  "deploy_rolled_back",
]);

export function addEvent(mission, phase, note) {
  mission.events.push({ at: new Date().toISOString(), phase, note: String(note).slice(0, 500) });
  while (mission.events.length > 120) mission.events.shift();
}

/**
 * Boot-time reconciliation: any mission left in an active status by a dead
 * process is marked interrupted (resumable) — a mission is never silently
 * lost to a crash/restart.
 */
export async function reconcileInterrupted(cfg) {
  const marked = [];
  for (const m of await listMissions(cfg, { limit: 200 })) {
    if (ACTIVE_STATUSES.has(m.status)) {
      m.status = "interrupted";
      addEvent(m, "recovery", "process restarted while mission was active — marked interrupted (resumable)");
      await saveMission(cfg, m);
      marked.push(m.id);
    }
  }
  return marked;
}
