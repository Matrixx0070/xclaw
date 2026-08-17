/**
 * Job checkpoints for recovery / resume after transport or budget failures.
 * Mid-run snapshots + strategy-based recovery.
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
    status: job.status || "running",
    pass: job.pass ?? null,
    turns: job.turns ?? 0,
    text: String(job.text || "").slice(0, 4000),
    error: job.error,
    verify: job.verify,
    toolTrace: (job.toolTrace || []).slice(-20),
    evidence: (job.evidence || []).slice(-30),
    groundingWarnings: job.groundingWarnings || [],
    midRun: Boolean(job.midRun),
    checkpointTurn: job.checkpointTurn ?? job.turns ?? null,
    at: new Date().toISOString(),
    maxTurns: job.maxTurns,
  };
  const tmp = fp + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(slim, null, 2));
  await fs.rename(tmp, fp);
  return fp;
}

/**
 * Mid-run checkpoint (every N turns). status stays "running".
 */
export async function saveMidRunCheckpoint(cfg, partial) {
  return saveCheckpoint(cfg, {
    ...partial,
    status: "running",
    pass: null,
    midRun: true,
    checkpointTurn: partial.turns ?? partial.checkpointTurn,
  });
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
        midRun: j.midRun,
        turns: j.turns,
        path: path.join(d, f),
      });
    } catch {
      /* */
    }
  }
  return out;
}

/** Classify checkpoint / job error for recovery strategy */
export function classifyFailure(error = "", cp = null) {
  const e = String(error || cp?.error || "");
  if (cp?.midRun && !e) return "interrupted";
  if (/ECONNREFUSED|not healthy|not available|ETIMEDOUT|fetch failed|network/i.test(e))
    return "transport";
  if (/BUDGET_EXCEEDED|budget|maxTurns|aborted|timeout/i.test(e)) return "budget";
  if (/denied|not_allowlisted|approval|APPROVAL_/i.test(e)) return "security";
  if (/grounding|claim|ungrounded|MARK_/i.test(e)) return "grounding";
  if (/verify|file_contains|file_exists|exitCode/i.test(e)) return "verify";
  if (cp?.status === "running" && cp?.midRun) return "interrupted";
  return "unknown";
}

/**
 * Recovery playbook per failure class.
 */
export function recoveryStrategyFor(kind, cp = {}, opts = {}) {
  const used = cp.turns || 0;
  const baseMax = cp.maxTurns || opts.maxTurns || 12;
  const remaining = Math.max(4, baseMax - Math.floor(used / 2));

  switch (kind) {
    case "transport":
      return {
        strategy: "transport",
        maxTurns: remaining,
        goalSuffix: [
          "[RECOVERY:transport] Computer/provider was unavailable.",
          "Workspace files may already be partially written — inspect before rewriting.",
          "Retry the same goal; prefer read/list first, then finish missing steps only.",
        ].join("\n"),
        groundHard: true,
      };
    case "budget":
      return {
        strategy: "budget",
        maxTurns: Math.max(remaining, Math.min(16, remaining + 4)),
        goalSuffix: [
          "[RECOVERY:budget] Turn/time/cost budget was hit.",
          "Be minimal: only finish incomplete verify targets.",
          "Do not re-explore solved subproblems. Cite tools in structured claims.",
        ].join("\n"),
        groundHard: true,
      };
    case "security":
      return {
        strategy: "security",
        maxTurns: remaining,
        goalSuffix: [
          "[RECOVERY:security] A tool was denied or awaited approval.",
          "Use only allowlisted tools. Prefer read-only inspection if writes were blocked.",
          "If approval is required, state that clearly instead of inventing success.",
        ].join("\n"),
        groundHard: true,
      };
    case "grounding":
      return {
        strategy: "grounding",
        maxTurns: remaining,
        goalSuffix: [
          "[RECOVERY:grounding] Prior claims failed evidence checks.",
          ...(cp.groundingWarnings || []).slice(0, 8).map((w) => `- ${w}`),
          "Re-run with tools only. Re-read after every write. No invented paths or outputs.",
          "End with structured claims that cite real tool evidence_ids.",
        ].join("\n"),
        groundHard: true,
        claimsRequireEvidence: true,
        requireStructuredClaims: true,
      };
    case "verify":
      return {
        strategy: "verify",
        maxTurns: remaining,
        goalSuffix: [
          "[RECOVERY:verify] Objective verify checks failed.",
          cp.verify
            ? `Last verify: ${JSON.stringify(cp.verify).slice(0, 800)}`
            : "",
          "Fix only what failed. Re-run the failing check yourself via tools before finishing.",
        ]
          .filter(Boolean)
          .join("\n"),
        groundHard: true,
      };
    case "interrupted":
      return {
        strategy: "interrupted",
        maxTurns: remaining,
        goalSuffix: [
          `[RECOVERY:interrupted] Mid-run checkpoint at turn ${cp.checkpointTurn ?? cp.turns ?? "?"}.`,
          "Continue from workspace state. Do not redo completed correct work.",
          "Verify final artifacts with tools before claiming success.",
        ].join("\n"),
        groundHard: true,
      };
    default:
      return {
        strategy: "unknown",
        maxTurns: remaining,
        goalSuffix: [
          "[RECOVERY] Previous attempt stopped.",
          cp.error ? `Last error: ${cp.error}` : "",
          "Continue from workspace. Prefer verify-by-tool. Do not invent results.",
        ]
          .filter(Boolean)
          .join("\n"),
        groundHard: true,
      };
  }
}

/**
 * Resume: classify failure → strategy → re-run with tailored recovery prompt.
 */
export async function resumeJobFromCheckpoint(cfg, jobId, opts = {}) {
  const cp = await loadCheckpoint(cfg, jobId);
  if (cp.pass) {
    return { ...cp, resumed: false, note: "already passed" };
  }

  const kind = opts.strategy || classifyFailure(opts.error || cp.error, cp);
  const plan = recoveryStrategyFor(kind, cp, opts);

  const goal = [cp.goal, "", plan.goalSuffix].filter(Boolean).join("\n\n");

  const jobOpts = {
    id: `${cp.id}_resume_${Date.now().toString(36)}`,
    goal,
    cfg,
    workspace: cp.workspace,
    maxTurns: opts.maxTurns ?? plan.maxTurns,
    autoApprove: opts.autoApprove ?? cfg.security?.autoApprove,
    groundHard: plan.groundHard ?? true,
    claimsRequireEvidence: plan.claimsRequireEvidence,
    requireStructuredClaims: plan.requireStructuredClaims,
    onEvent: opts.onEvent,
    persistRun: true,
  };

  let job;
  if (
    opts.useHarness === true ||
    (opts.useHarness !== false &&
      (kind === "grounding" || kind === "verify") &&
      cfg.harness)
  ) {
    try {
      const { runLongHarness } = await import("./long-harness.mjs");
      job = await runLongHarness(jobOpts);
    } catch {
      job = await runJob(jobOpts);
    }
  } else {
    job = await runJob(jobOpts);
  }

  job.resumedFrom = cp.id;
  job.recoveryStrategy = plan.strategy;
  job.recoveryKind = kind;
  return job;
}
