/**
 * Persistent job history under ~/.xclaw/jobs/
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildToolHashChain } from "../agent/tool-hash-chain.mjs";

export function jobsDir(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "jobs");
}

export async function ensureJobsDir(cfg) {
  const dir = jobsDir(cfg);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Store a slim job record for history/API.
 */
export async function recordJob(cfg, job) {
  const dir = await ensureJobsDir(cfg);
  const slim = {
    id: job.id,
    goal: String(job.goal || "").slice(0, 500),
    status: job.status,
    pass: job.pass,
    turns: job.turns,
    toolCalls: job.toolCalls,
    toolErrors: job.toolErrors,
    wallMs: job.wallMs,
    model: job.model,
    error: job.error || null,
    textPreview: String(job.text || "").slice(0, 400),
    evidenceCount: (job.evidence || []).length,
    verifyOk: job.verify ? job.verify.ok : null,
    workspace: job.workspace,
    at: new Date().toISOString(),
  };
  const chain = job.toolHashTip
    ? { tip: job.toolHashTip, version: job.toolHashVersion || 1 }
    : buildToolHashChain(job.toolTrace || []);
  slim.toolHashTip = chain.tip;
  slim.toolHashVersion = chain.version;
  const fp = path.join(dir, `${job.id}.json`);
  await fs.writeFile(fp, JSON.stringify({ ...slim, evidence: job.evidence || [], verify: job.verify || null }, null, 2));
  const indexPath = path.join(dir, "index.jsonl");
  await fs.appendFile(indexPath, JSON.stringify(slim) + "\n");
  return { path: fp, slim };
}

/**
 * @param {object} cfg
 * @param {{ limit?: number }} [opts]
 */
export async function listJobs(cfg, opts = {}) {
  const dir = await ensureJobsDir(cfg);
  const indexPath = path.join(dir, "index.jsonl");
  let lines = [];
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    lines = raw.split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const limit = opts.limit ?? 30;
  const items = lines
    .slice(-Math.max(limit * 2, limit))
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse()
    .slice(0, limit);
  return items;
}

export async function getJob(cfg, id) {
  const dir = await ensureJobsDir(cfg);
  const fp = path.join(dir, `${id}.json`);
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}
