/**
 * Job checkpoints for recovery / resume after transport or budget failures.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runJob } from "./job.mjs";

function dir(cfg) {
  return path.join(cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"), "checkpoints");
}

export async function saveCheckpoint(cfg, job) {
  const d = dir(cfg);
  await fs.mkdir(d, { recursive: true });
  const fp = path.join(d, `${job.id}.json`);
  const slim = {
    id: job.id,
    goal: job.goal,
    workspace: job.workspace,
    status: job.status,
    pass: job.pass,
    turns: job.turns,
    text: String(job.text || "").slice(0, 4000),
    error: job.error,
    verify: job.verify,
    toolTrace: (job.toolTrace || []).slice(-12),
    at: new Date().toISOString(),
    maxTurns: job.maxTurns,
  };
  await fs.writeFile(fp, JSON.stringify(slim, null, 2));
  return fp;
}

export async function loadCheckpoint(cfg, jobId) {
  const fp = path.join(dir(cfg), `${jobId}.json`);
  const raw = await fs.readFile(fp, "utf8");
  return JSON.parse(raw);
}

export async function listCheckpoints(cfg, { limit = 20 } = {}) {
  const d = dir(cfg);
  let files = [];
  try {
    files = (await fs.readdir(d)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  files.sort().reverse();
  const out = [];
  for (const f of files.slice(0, limit)) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(d, f), "utf8"));
      out.push({
        id: j.id,
        status: j.status,
        goal: j.goal,
        at: j.at,
        path: path.join(d, f),
      });
    } catch {
      /* */
    }
  }
  return out;
}

/**
 * Resume: re-run goal with remaining turn budget + recovery note in prompt.
 */
export async function resumeJobFromCheckpoint(cfg, jobId, opts = {}) {
  const cp = await loadCheckpoint(cfg, jobId);
  if (cp.pass) {
    return { ...cp, resumed: false, note: "already passed" };
  }
  const used = cp.turns || 0;
  const maxTurns = Math.max(4, (cp.maxTurns || cfg.agent?.maxTurns || 12) - Math.floor(used / 2));
  const goal = [
    cp.goal,
    "",
    "[RECOVERY] Previous attempt failed or stopped.",
    cp.error ? `Last error: ${cp.error}` : "",
    "Continue from current workspace state. Do not redo completed file writes if already correct. Verify before finishing.",
  ]
    .filter(Boolean)
    .join("\n");

  const job = await runJob({
    id: `${cp.id}_resume_${Date.now().toString(36)}`,
    goal,
    cfg,
    workspace: cp.workspace,
    maxTurns,
    autoApprove: opts.autoApprove ?? cfg.security?.autoApprove,
    onEvent: opts.onEvent,
  });
  job.resumedFrom = cp.id;
  return job;
}

/** Classify error for recovery strategy */
export function classifyFailure(error = "") {
  const e = String(error);
  if (/ECONNREFUSED|not healthy|not available|timeout/i.test(e)) return "transport";
  if (/budget|maxTurns|aborted/i.test(e)) return "budget";
  if (/denied|not_allowlisted|approval/i.test(e)) return "security";
  if (/grounding|claim/i.test(e)) return "grounding";
  return "unknown";
}
