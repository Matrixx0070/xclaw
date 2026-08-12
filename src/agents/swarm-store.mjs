/**
 * S0 — Durable swarm / subagent registry under ~/.xclaw/swarms/
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

function rootDir(cfg) {
  return path.join(
    cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"),
    "swarms"
  );
}

function runsDir(cfg) {
  return path.join(rootDir(cfg), "runs");
}

function agentsDir(cfg) {
  return path.join(rootDir(cfg), "agents");
}

async function ensureDirs(cfg) {
  await fs.mkdir(runsDir(cfg), { recursive: true });
  await fs.mkdir(agentsDir(cfg), { recursive: true });
}

export async function saveSubagentSnapshot(cfg, record) {
  if (!cfg) return;
  await ensureDirs(cfg);
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
  const fp = path.join(agentsDir(cfg), `${record.id}.json`);
  await fs.writeFile(fp, JSON.stringify(slim, null, 2) + "\n");
  return fp;
}

export async function loadSubagentSnapshot(cfg, id) {
  try {
    const raw = await fs.readFile(path.join(agentsDir(cfg), `${id}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listPersistedSubagents(cfg, { status, limit = 50 } = {}) {
  await ensureDirs(cfg);
  let files = [];
  try {
    files = (await fs.readdir(agentsDir(cfg))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files.slice(0, limit * 2)) {
    try {
      const rec = JSON.parse(
        await fs.readFile(path.join(agentsDir(cfg), f), "utf8")
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
      path.join(agentsDir(cfg), `${rec.id}.json`),
      JSON.stringify(rec, null, 2) + "\n"
    );
    marked += 1;
  }
  return { marked };
}

export async function createSwarmRun(cfg, input = {}) {
  await ensureDirs(cfg);
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
  await fs.writeFile(
    path.join(runsDir(cfg), `${id}.json`),
    JSON.stringify(run, null, 2) + "\n"
  );
  return run;
}

export async function updateSwarmRun(cfg, id, patch = {}) {
  const fp = path.join(runsDir(cfg), `${id}.json`);
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
  try {
    return JSON.parse(
      await fs.readFile(path.join(runsDir(cfg), `${id}.json`), "utf8")
    );
  } catch {
    return null;
  }
}

export async function listSwarmRuns(cfg, { limit = 30 } = {}) {
  await ensureDirs(cfg);
  let files = [];
  try {
    files = (await fs.readdir(runsDir(cfg))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push(
        JSON.parse(await fs.readFile(path.join(runsDir(cfg), f), "utf8"))
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
