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
    resumedBy: job.resumedBy || null,
    resumedAt: job.resumedAt || null,
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
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(d, f), "utf8"));
      out.push({
        id: j.id,
        status: j.status,
        goal: j.goal,
        at: j.at,
        midRun: j.midRun,
        turns: j.turns,
        resumedBy: j.resumedBy || null,
        path: path.join(d, f),
      });
    } catch {
      /* */
    }
  }
  out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return out.slice(0, limit);
}


/**
 * Evict old terminal checkpoints.
 * Never deletes status running|resuming unless opts.forceAll.
 *
 * cfg.checkpoints.maxCount (default 100)
 * cfg.checkpoints.maxAgeMs (default 14d)
 * cfg.checkpoints.pruneOnSave (default false — call explicitly or from evolve)
 */
export async function pruneCheckpoints(cfg, opts = {}) {
  const cpc = cfg?.checkpoints || {};
  const maxCount = opts.maxCount ?? cpc.maxCount ?? 100;
  const maxAgeMs =
    opts.maxAgeMs ??
    cpc.maxAgeMs ??
    14 * 24 * 60 * 60 * 1000;
  const forceAll = opts.forceAll === true;
  const keep = new Set(
    opts.keepStatuses ||
      cpc.keepStatuses || ["running", "resuming"]
  );

  const d = dir(cfg);
  let files = [];
  try {
    files = (await fs.readdir(d)).filter((f) => f.endsWith(".json"));
  } catch {
    return { removed: 0, kept: 0, reason: "no_dir" };
  }

  const rows = [];
  for (const f of files) {
    const fp = path.join(d, f);
    try {
      const j = JSON.parse(await fs.readFile(fp, "utf8"));
      rows.push({
        fp,
        id: j.id || f.replace(/\.json$/, ""),
        status: j.status || "unknown",
        at: Date.parse(j.at || 0) || 0,
        midRun: Boolean(j.midRun),
      });
    } catch {
      // corrupt → eligible for removal
      rows.push({ fp, id: f, status: "corrupt", at: 0, midRun: false });
    }
  }

  rows.sort((a, b) => b.at - a.at);
  const now = Date.now();
  const toRemove = [];
  let keptProtected = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const protectedStatus = keep.has(r.status) || (r.midRun && r.status === "running");
    if (protectedStatus && !forceAll) {
      keptProtected += 1;
      continue;
    }
    const tooOld = maxAgeMs > 0 && r.at > 0 && now - r.at > maxAgeMs;
    const overCount = maxCount > 0 && i >= maxCount;
    // Count only non-protected toward maxCount: recompute index among evictable
    if (tooOld || overCount) {
      toRemove.push(r);
    }
  }

  // Refine maxCount: among non-protected, keep newest maxCount
  const evictable = rows.filter(
    (r) => forceAll || !(keep.has(r.status) || (r.midRun && r.status === "running"))
  );
  const over = maxCount > 0 ? evictable.slice(maxCount) : [];
  const old = maxAgeMs > 0
    ? evictable.filter((r) => r.at > 0 && now - r.at > maxAgeMs)
    : [];
  const removeSet = new Map();
  for (const r of [...over, ...old]) {
    removeSet.set(r.fp, r);
  }
  // corrupt always removable
  for (const r of rows) {
    if (r.status === "corrupt") removeSet.set(r.fp, r);
  }

  let removed = 0;
  if (!opts.dryRun) {
    for (const r of removeSet.values()) {
      try {
        await fs.unlink(r.fp);
        removed += 1;
      } catch {
        /* */
      }
    }
  } else {
    removed = removeSet.size;
  }

  return {
    removed,
    kept: rows.length - (opts.dryRun ? 0 : removed),
    protected: keptProtected,
    dryRun: Boolean(opts.dryRun),
    maxCount,
    maxAgeMs,
  };
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
 * Mark parent checkpoint so auto-resume will not pick it again.
 */
export async function markCheckpointResumed(cfg, jobId, { resumedBy, status = "resumed" } = {}) {
  const cp = await loadCheckpoint(cfg, jobId);
  cp.status = status;
  cp.midRun = false;
  cp.resumedBy = resumedBy || null;
  cp.resumedAt = new Date().toISOString();
  await saveCheckpoint(cfg, cp);
  return cp;
}

/** In-process lock to reduce double-resume races within one process */
const resumeLocks = new Set();

function lockPath(cfg, jobId) {
  return path.join(dir(cfg), ".locks", `${String(jobId)}.lock`);
}

/**
 * In-process + cross-process lock (exclusive lock file under checkpoints/.locks/).
 * @returns {boolean|Promise<boolean>}
 */
export function tryAcquireResumeLock(jobId, cfg = null) {
  const id = String(jobId || "");
  if (!id || resumeLocks.has(id)) return false;
  resumeLocks.add(id);
  if (!cfg) return true;
  // Sync-ish via deasync-free path: return Promise when cfg provided
  return acquireFileLock(cfg, id);
}

async function acquireFileLock(cfg, id) {
  const fp = lockPath(cfg, id);
  try {
    await fs.mkdir(path.dirname(fp), { recursive: true });
    const fh = await fs.open(fp, "wx"); // exclusive create
    await fh.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() })
    );
    await fh.close();
    return true;
  } catch (err) {
    if (err && (err.code === "EEXIST" || err.code === "EACCES")) {
      // Stale lock: if older than 2h, steal
      try {
        const st = await fs.stat(fp);
        if (Date.now() - st.mtimeMs > 2 * 60 * 60 * 1000) {
          await fs.unlink(fp).catch(() => {});
          return acquireFileLock(cfg, id);
        }
      } catch {
        /* */
      }
      resumeLocks.delete(id);
      return false;
    }
    resumeLocks.delete(id);
    return false;
  }
}

export async function releaseResumeLock(jobId, cfg = null) {
  const id = String(jobId || "");
  resumeLocks.delete(id);
  if (!cfg) return;
  try {
    await fs.unlink(lockPath(cfg, id));
  } catch {
    /* */
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
  if (cp.status === "resumed" && cp.resumedBy && !opts.force) {
    return {
      ...cp,
      resumed: false,
      note: "already_resumed",
      resumedBy: cp.resumedBy,
    };
  }
  if (cp.status === "resuming" && !opts.force) {
    return { ...cp, resumed: false, note: "resume_in_progress" };
  }

  const gotLock = await tryAcquireResumeLock(jobId, cfg);
  if (!gotLock && !opts.force) {
    return {
      id: jobId,
      resumed: false,
      note: "resume_locked",
      pass: false,
      status: "running",
    };
  }

  try {
  // Mark parent as resuming so parallel ticks skip it
  try {
    cp.status = "resuming";
    cp.midRun = false;
    await saveCheckpoint(cfg, cp);
  } catch {
    /* */
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

  try {
    await markCheckpointResumed(cfg, jobId, { resumedBy: job.id, status: "resumed" });
  } catch {
    /* */
  }
  return job;
  } finally {
    await releaseResumeLock(jobId, cfg);
  }
}
