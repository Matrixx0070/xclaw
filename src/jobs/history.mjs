/**
 * Persistent job history under <configDir>/jobs/.
 *
 * jobs/ belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * history, so instance B listed instance A's jobs — and the suite wrote
 * into the operator's real `~/.xclaw/jobs/`.
 *
 * Production writers (`recordJob(cfg)` at jobs/job.mjs and jobs/queue.mjs)
 * already had cfg in scope. `loadConfig()` stamps `paths.configDir`
 * unconditionally (config/load.mjs:187), so a cfg without one is never a
 * real caller. Such a path is `null` rather than guessing at the home dir.
 * Same shape as `queueDir`. Honour existing `XCLAW_CONFIG_DIR`.
 * `ensureJobsDir` no-ops a null path (do not `mkdir(null)`). `listJobs`
 * returns `[]`. `recordJob` still stamps the in-memory job without
 * persisting. `getJob` returns null.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { buildToolHashChain } from "../agent/tool-hash-chain.mjs";
import { buildReceiptMetrics, stampReceiptMetrics } from "./receipt-metrics.mjs";
import { ensureQuotaHardCircuitOnJob } from "./receipt-collector.mjs";
import { mergeReceiptSnapshotIntoJob } from "./history-receipt.mjs";

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function jobsDir(cfg = {}) {
  const dir = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "jobs") : null;
}

export async function ensureJobsDir(cfg) {
  const dir = jobsDir(cfg);
  if (!dir) return null;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Store a slim job record for history/API.
 */
export async function recordJob(cfg, job) {
  job = mergeReceiptSnapshotIntoJob(job);
  const dir = await ensureJobsDir(cfg);
  ensureQuotaHardCircuitOnJob(job);
  stampReceiptMetrics(job);
  const receiptMetrics = job.receiptMetrics || buildReceiptMetrics(job);
  const slim = {
    id: job.id,
    goal: String(job.goal || "").slice(0, 500),
    status: job.status,
    pass: job.pass,
    // S2: verdict provenance and why the run ended must survive into the
    // durable record — resume/recovery decisions read THIS file, not the
    // in-process job object.
    verdict: job.verdict || null,
    stopReason: job.stopReason || null,
    turns: job.turns,
    toolCalls: job.toolCalls,
    toolErrors: job.toolErrors,
    wallMs: job.wallMs,
    model: job.model,
    error: job.error || null,
    costBlocked: job.costBlocked || false,
    quotaEscalate: job.quotaEscalate || null,
    quotaHardCircuit: job.quotaHardCircuit || null,
    textPreview: String(job.text || "").slice(0, 400),
    evidenceCount: (job.evidence || []).length,
    verifyOk: job.verify ? job.verify.ok : null,
    workspace: job.workspace,
    at: new Date().toISOString(),
    receiptMetrics,
    claimsSoftRetry: receiptMetrics.claimsSoftRetry,
    quotaEscalate: receiptMetrics.quotaEscalate,
    quotaHardCircuit:
      job.quotaHardCircuit || receiptMetrics.quotaHardCircuit || null,
  };
  const chain = job.toolHashTip
    ? { tip: job.toolHashTip, version: job.toolHashVersion || 1 }
    : buildToolHashChain(job.toolTrace || []);
  slim.toolHashTip = chain.tip;
  slim.toolHashVersion = chain.version;
  job.toolHashTip = chain.tip;
  job.toolHashVersion = chain.version;
  if (!dir) return { path: null, slim };
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
  if (!dir) return [];
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
  if (!dir) return null;
  const fp = path.join(dir, `${id}.json`);
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    return null;
  }
}
