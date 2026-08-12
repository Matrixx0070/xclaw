/**
 * Public ops SLOs — job wall p99, computer uptime signal, approval wait.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isComputerRunning } from "../computer/manager.mjs";
import { getSharedApprovalGate } from "../security/approvals.mjs";

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function recentJobWallMs(cfg, limit = 50) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  const hist = path.join(base, "jobs", "index.jsonl");
  try {
    const raw = await fs.readFile(hist, "utf8");
    const walls = [];
    for (const line of raw.split("\n").filter(Boolean).slice(-limit)) {
      try {
        const j = JSON.parse(line);
        if (typeof j.wallMs === "number") walls.push(j.wallMs);
      } catch {
        /* */
      }
    }
    return walls.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function computeSLOs(cfg) {
  const targets = cfg?.slo || {
    jobWallP99Ms: 120_000,
    computerUp: true,
    approvalPendingMax: 10,
    approvalAgeP99Ms: 300_000,
  };
  const walls = await recentJobWallMs(cfg);
  const jobWallP99 = percentile(walls, 99);
  const jobWallP50 = percentile(walls, 50);
  let computerUp = false;
  try {
    computerUp = await isComputerRunning(cfg);
  } catch {
    /* */
  }
  const gate = getSharedApprovalGate(cfg);
  const pending = gate.listPending?.() || [];
  const ages = pending.map((p) => p.ageMs || 0).sort((a, b) => a - b);
  const approvalAgeP99 = percentile(ages, 99);

  const breaches = [];
  if (jobWallP99 != null && targets.jobWallP99Ms && jobWallP99 > targets.jobWallP99Ms) {
    breaches.push(`job_wall_p99 ${jobWallP99}>${targets.jobWallP99Ms}`);
  }
  if (targets.computerUp && !computerUp) {
    breaches.push("computer_down");
  }
  if (pending.length > (targets.approvalPendingMax ?? 10)) {
    breaches.push(`approvals_pending ${pending.length}`);
  }
  if (
    approvalAgeP99 != null &&
    targets.approvalAgeP99Ms &&
    approvalAgeP99 > targets.approvalAgeP99Ms
  ) {
    breaches.push(`approval_age_p99 ${approvalAgeP99}>${targets.approvalAgeP99Ms}`);
  }

  return {
    at: new Date().toISOString(),
    targets,
    jobWallP50Ms: jobWallP50,
    jobWallP99Ms: jobWallP99,
    computerUp,
    approvalPending: pending.length,
    approvalAgeP99Ms: approvalAgeP99,
    sampleJobs: walls.length,
    breaches,
    ok: breaches.length === 0,
  };
}
