/**
 * S0 — Durable swarm / subagent registry under <configDir>/swarms/
 *
 * swarms/ belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * swarms/ directory, so instance B listed instance A's runs —
 * and the suite wrote into the operator's real `~/.xclaw/swarms`.
 *
 * Production writers (`createSwarmRun(cfg)` at agents/swarm-run.mjs,
 * `saveSubagentSnapshot` via `configureSubagentPersistence(cfg)` at
 * gateway/index.mjs:1071) already had cfg in scope. `loadConfig()` stamps
 * `paths.configDir` unconditionally (config/load.mjs:187), so a cfg
 * without one is never a real caller. Such a path is `null` rather than
 * guessing at the home dir. Same shape as `transcriptDir`. Honour existing
 * `XCLAW_CONFIG_DIR`. `createSwarmRun` still returns the in-memory run
 * without persisting. `saveSubagentSnapshot` still no-ops. `listSwarmRuns`
 * returns `[]`. Do not `mkdir(null)`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null. No home fallback.
 */
export function swarmStoreRoot(cfg = {}) {
  const base = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return base ? path.join(base, "swarms") : null;
}

function rootDir(cfg) {
  return swarmStoreRoot(cfg);
}

function runsDir(cfg) {
  const root = rootDir(cfg);
  return root ? path.join(root, "runs") : null;
}

function agentsDir(cfg) {
  const root = rootDir(cfg);
  return root ? path.join(root, "agents") : null;
}

async function ensureDirs(cfg) {
  const runs = runsDir(cfg);
  const agents = agentsDir(cfg);
  if (!runs || !agents) return;
  await fs.mkdir(runs, { recursive: true });
  await fs.mkdir(agents, { recursive: true });
}

export async function saveSubagentSnapshot(cfg, record) {
  if (!cfg) return;
  const slim = {
    id: record.id,
    parentId: record.parentId || null,
    swarmId: record.swarmId || null,
    task: record.task,
    status: record.status,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt || null,
    error: record.error || null,
    workspace: record.workspace || record.result?.workspace || null,
    isolated: Boolean(record.isolated || record.result?.isolated),
    worktree: record.worktree || record.result?.worktree || null,
    timeoutMs: record.timeoutMs || null,
    resultText: record.result?.text
      ? String(record.result.text).slice(0, 2000)
      : null,
    updatedAt: new Date().toISOString(),
  };
  const dir = agentsDir(cfg);
  if (!dir) return slim;
  await ensureDirs(cfg);
  const fp = path.join(dir, `${record.id}.json`);
  await fs.writeFile(fp, JSON.stringify(slim, null, 2) + "\n");
  return fp;
}

export async function loadSubagentSnapshot(cfg, id) {
  const dir = agentsDir(cfg);
  if (!dir) return null;
  try {
    const raw = await fs.readFile(path.join(dir, `${id}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listPersistedSubagents(cfg, { status, limit = 50 } = {}) {
  const dir = agentsDir(cfg);
  if (!dir) return [];
  await ensureDirs(cfg);
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files.slice(0, limit * 2)) {
    try {
      const rec = JSON.parse(
        await fs.readFile(path.join(dir, f), "utf8")
      );
      if (status && rec.status !== status) continue;
      out.push(rec);
    } catch {
      /* */
    }
  }
  out.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return out.slice(0, limit);
}

/**
 * Mark in-memory-lost "running" agents as interrupted after restart.
 */
export async function reconcileStaleAgents(cfg, liveIds = new Set()) {
  const dir = agentsDir(cfg);
  if (!dir) return { marked: 0 };
  const all = await listPersistedSubagents(cfg, { limit: 200 });
  let marked = 0;
  for (const rec of all) {
    if (rec.status !== "running") continue;
    if (liveIds.has(rec.id)) continue;
    rec.status = "interrupted";
    rec.error = rec.error || "gateway restarted while running";
    rec.finishedAt = rec.finishedAt || new Date().toISOString();
    rec.updatedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(dir, `${rec.id}.json`),
      JSON.stringify(rec, null, 2) + "\n"
    );
    marked += 1;
  }
  return { marked };
}

export async function createSwarmRun(cfg, input = {}) {
  const id = input.id || randomUUID();
  const run = {
    id,
    goal: input.goal || "",
    status: input.status || "running",
    parentSession: input.parentSession || null,
    accountId: input.accountId || null,
    children: input.children || [],
    budget: input.budget || {},
    policy: input.policy || {},
    createdAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  const dir = runsDir(cfg);
  if (!dir) return run;
  await ensureDirs(cfg);
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify(run, null, 2) + "\n"
  );
  return run;
}

export async function updateSwarmRun(cfg, id, patch = {}) {
  const dir = runsDir(cfg);
  if (!dir) return null;
  const fp = path.join(dir, `${id}.json`);
  let run;
  try {
    run = JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
  Object.assign(run, patch, { updatedAt: new Date().toISOString() });
  await fs.writeFile(fp, JSON.stringify(run, null, 2) + "\n");
  return run;
}

export async function getSwarmRun(cfg, id) {
  const dir = runsDir(cfg);
  if (!dir) return null;
  try {
    return JSON.parse(
      await fs.readFile(path.join(dir, `${id}.json`), "utf8")
    );
  } catch {
    return null;
  }
}

export async function listSwarmRuns(cfg, { limit = 30 } = {}) {
  const dir = runsDir(cfg);
  if (!dir) return [];
  await ensureDirs(cfg);
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push(
        JSON.parse(await fs.readFile(path.join(dir, f), "utf8"))
      );
    } catch {
      /* */
    }
  }
  out.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return out.slice(0, limit);
}

export function swarmStorePaths(cfg) {
  return { root: rootDir(cfg), runs: runsDir(cfg), agents: agentsDir(cfg) };
}
