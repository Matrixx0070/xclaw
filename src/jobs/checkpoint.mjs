/**
 * Job checkpoints for recovery / resume after transport or budget failures.
 * Mid-run snapshots + strategy-based recovery.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runJob } from "./job.mjs";
import { withBackoff } from "../utils/backoff.mjs";
import { stampJobToolHash } from "./stamp-tool-hash.mjs";
import { verifyCheckpointToolHash } from "./checkpoint-hash-verify.mjs";
import { shouldRequireToolHashTip } from "./checkpoint-require-tip.mjs";
import { rehydrateReceiptFromCheckpoint } from "./checkpoint-receipt.mjs";

/** Structured resume / lock error codes */
export const RESUME_CODES = {
  NOT_FOUND: "CHECKPOINT_NOT_FOUND",
  CORRUPT: "CHECKPOINT_CORRUPT",
  ALREADY_PASSED: "CHECKPOINT_ALREADY_PASSED",
  ALREADY_RESUMED: "CHECKPOINT_ALREADY_RESUMED",
  RESUME_IN_PROGRESS: "CHECKPOINT_RESUME_IN_PROGRESS",
  LOCKED: "CHECKPOINT_RESUME_LOCKED",
  LOCK_IO: "CHECKPOINT_LOCK_IO",
  AGENT_FAILED: "CHECKPOINT_RESUME_AGENT_FAILED",
};

/** Frozen checkpoint document version (job recovery). */
export const CHECKPOINT_SCHEMA_VERSION = 1;

/**
 * Contract for checkpoint JSON on disk.
 * Legacy files without schemaVersion are migratable to v1.
 */
export const CHECKPOINT_SCHEMA_V1 = Object.freeze({
  $id: "xclaw://job-checkpoint/v1",
  schemaVersion: CHECKPOINT_SCHEMA_VERSION,
  required: ["id", "goal", "status", "at", "schemaVersion"],
  properties: {
    schemaVersion: { type: "number", const: 1 },
    id: { type: "string", minLength: 1 },
    goal: { type: "string" },
    workspace: { type: ["string", "null"] },
    status: { type: "string" },
    pass: { type: ["boolean", "null"] },
    turns: { type: ["number", "null"] },
    text: { type: ["string", "null"] },
    error: {},
    midRun: { type: ["boolean", "null"] },
    checkpointTurn: { type: ["number", "null"] },
    at: { type: "string", minLength: 1 },
    maxTurns: { type: ["number", "null"] },
    resumedBy: { type: ["string", "null"] },
    resumedAt: { type: ["string", "null"] },
    toolTrace: { type: ["array", "null"] },
    evidence: { type: ["array", "null"] },
  },
});

/**
 * @returns {{ ok: boolean, errors: string[], schema: string }}
 */
export function validateCheckpointShape(doc) {
  const errors = [];
  const schema = CHECKPOINT_SCHEMA_V1;
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, errors: ["checkpoint must be a non-null object"], schema: schema.$id };
  }
  for (const key of schema.required) {
    if (doc[key] === undefined || doc[key] === null || doc[key] === "") {
      errors.push(`missing required field: ${key}`);
    }
  }
  if (doc.schemaVersion != null && Number(doc.schemaVersion) !== CHECKPOINT_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion ${doc.schemaVersion} (want ${CHECKPOINT_SCHEMA_VERSION})`);
  }
  if (doc.id != null && typeof doc.id !== "string") {
    errors.push("id must be string");
  }
  if (doc.at != null && typeof doc.at !== "string") {
    errors.push("at must be string");
  }
  return { ok: errors.length === 0, errors, schema: schema.$id };
}

/**
 * Migrate legacy checkpoint (no schemaVersion) → v1.
 * @returns {{ receipt: object, migrated: boolean, from: number|null }}
 */
export function migrateCheckpoint(doc) {
  if (doc == null || typeof doc !== "object") {
    return { receipt: doc, migrated: false, from: null };
  }
  const from = doc.schemaVersion != null ? Number(doc.schemaVersion) : null;
  if (from === CHECKPOINT_SCHEMA_VERSION) {
    return { receipt: { ...doc }, migrated: false, from };
  }
  const next = {
    ...doc,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    id: doc.id || `job_${Date.now()}`,
    goal: doc.goal ?? "",
    status: doc.status || "running",
    at: doc.at || new Date().toISOString(),
  };
  return { receipt: next, migrated: true, from };
}

function dir(cfg) {
  return path.join(cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw"), "checkpoints");
}

export async function saveCheckpoint(cfg, job) {
  const d = dir(cfg);
  await fs.mkdir(d, { recursive: true });
  const fp = path.join(d, `${job.id}.json`);
  // Stamp tool-hash tip for mid-run and final checkpoints (integrity on resume).
  const stamped = stampJobToolHash({
    ...job,
    toolTrace: job.toolTrace || [],
    toolHashTip: job.toolHashTip,
    toolHashVersion: job.toolHashVersion,
  });
  const slim = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
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
    toolHashTip: stamped.toolHashTip || null,
    toolHashVersion: stamped.toolHashVersion || null,
    at: new Date().toISOString(),
    maxTurns: job.maxTurns,
    resumedBy: job.resumedBy || null,
    resumedAt: job.resumedAt || null,
    quotaEscalate: job.quotaEscalate || job.receiptMetrics?.quotaEscalate || null,
    receiptMetrics: job.receiptMetrics || null,
    claimsSoftRetry: job.claimsSoftRetry || job.receiptMetrics?.claimsSoftRetry || null,
    // rehydrateReceiptFromCheckpoint reads both of these on resume; without
    // persisting them a tripped circuit was silently lost across a restart.
    quotaHardCircuit:
      job.quotaHardCircuit ||
      job.receiptCollector?.quotaHardCircuit ||
      job.receiptMetrics?.quotaHardCircuit ||
      null,
    receiptCollector: job.receiptCollector || null,
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
  if (!jobId) {
    const err = new Error("checkpoint id required");
    err.code = RESUME_CODES.NOT_FOUND;
    throw err;
  }
  const fp = path.join(dir(cfg), `${jobId}.json`);
  let raw;
  try {
    raw = await fs.readFile(fp, "utf8");
  } catch (e) {
    const err = new Error(`checkpoint not found: ${jobId}`);
    err.code = RESUME_CODES.NOT_FOUND;
    err.cause = e;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    const { receipt } = migrateCheckpoint(parsed);
    return receipt;
  } catch (e) {
    if (e?.code === RESUME_CODES.CORRUPT) throw e;
    const err = new Error(`checkpoint corrupt: ${jobId}`);
    err.code = RESUME_CODES.CORRUPT;
    err.cause = e;
    throw err;
  }
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
      rows.push({ fp, id: f, status: "corrupt", at: 0, midRun: false });
    }
  }

  rows.sort((a, b) => b.at - a.at);
  const now = Date.now();
  let keptProtected = 0;
  for (const r of rows) {
    const protectedStatus = keep.has(r.status) || (r.midRun && r.status === "running");
    if (protectedStatus && !forceAll) keptProtected += 1;
  }

  const evictable = rows.filter(
    (r) => forceAll || !(keep.has(r.status) || (r.midRun && r.status === "running"))
  );
  const over = maxCount > 0 ? evictable.slice(maxCount) : [];
  const old = maxAgeMs > 0
    ? evictable.filter((r) => r.at > 0 && now - r.at > maxAgeMs)
    : [];
  const removeSet = new Map();
  for (const r of [...over, ...old]) removeSet.set(r.fp, r);
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

export async function markCheckpointResumed(cfg, jobId, { resumedBy, status = "resumed" } = {}) {
  const cp = await loadCheckpoint(cfg, jobId);
  cp.status = status;
  cp.midRun = false;
  cp.resumedBy = resumedBy || null;
  cp.resumedAt = new Date().toISOString();
  await saveCheckpoint(cfg, cp);
  return cp;
}

const resumeLocks = new Set();

function lockPath(cfg, jobId) {
  return path.join(dir(cfg), ".locks", `${String(jobId)}.lock`);
}

export function tryAcquireResumeLock(jobId, cfg = null) {
  const id = String(jobId || "");
  if (!id || resumeLocks.has(id)) return false;
  resumeLocks.add(id);
  if (!cfg) return true;
  return acquireFileLock(cfg, id);
}

async function acquireFileLock(cfg, id, attempt = 0) {
  const fp = lockPath(cfg, id);
  const maxLockAttempts = 3;
  try {
    await fs.mkdir(path.dirname(fp), { recursive: true });
    const fh = await fs.open(fp, "wx");
    await fh.writeFile(
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() })
    );
    await fh.close();
    return true;
  } catch (err) {
    if (err && (err.code === "EEXIST" || err.code === "EACCES")) {
      try {
        const st = await fs.stat(fp);
        if (Date.now() - st.mtimeMs > 2 * 60 * 60 * 1000) {
          await fs.unlink(fp).catch(() => {});
          return acquireFileLock(cfg, id, attempt);
        }
      } catch {
        /* */
      }
      resumeLocks.delete(id);
      return false;
    }
    if (
      attempt < maxLockAttempts - 1 &&
      err &&
      (err.code === "ENOENT" || err.code === "EMFILE" || err.code === "EAGAIN")
    ) {
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
      return acquireFileLock(cfg, id, attempt + 1);
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

export async function resumeJobFromCheckpoint(cfg, jobId, opts = {}) {
  let cp;
  try {
    cp = await loadCheckpoint(cfg, jobId);
  } catch (e) {
    return {
      id: jobId,
      resumed: false,
      pass: false,
      status: "error",
      note: e.code === RESUME_CODES.CORRUPT ? "corrupt" : "not_found",
      code: e.code || RESUME_CODES.NOT_FOUND,
      error: e.message || String(e),
    };
  }
  // Integrity: tool-hash tip must match stored toolTrace (unless opts.skipHashVerify)
  if (opts.skipHashVerify !== true && cfg?.checkpoints?.skipHashVerify !== true) {
    const hv = verifyCheckpointToolHash(cp, {
      requireTip: shouldRequireToolHashTip(cfg, opts),
    });
    if (!hv.ok) {
      return {
        id: jobId,
        resumed: false,
        pass: false,
        status: "error",
        note: "tool_hash_mismatch",
        code: hv.code,
        error: hv.message,
        expectedToolHashTip: hv.expected,
        actualToolHashTip: hv.actual,
      };
    }
  }

  rehydrateReceiptFromCheckpoint(cp, cp);
  if (cp.pass) {
    return {
      ...cp,
      resumed: false,
      note: "already passed",
      code: RESUME_CODES.ALREADY_PASSED,
    };
  }
  if (cp.status === "resumed" && cp.resumedBy && !opts.force) {
    return {
      ...cp,
      resumed: false,
      note: "already_resumed",
      code: RESUME_CODES.ALREADY_RESUMED,
      resumedBy: cp.resumedBy,
    };
  }
  if (cp.status === "resuming" && !opts.force) {
    return {
      ...cp,
      resumed: false,
      note: "resume_in_progress",
      code: RESUME_CODES.RESUME_IN_PROGRESS,
    };
  }

  const gotLock = await tryAcquireResumeLock(jobId, cfg);
  if (!gotLock && !opts.force) {
    return {
      id: jobId,
      resumed: false,
      note: "resume_locked",
      code: RESUME_CODES.LOCKED,
      pass: false,
      status: "running",
      error: "another process holds the resume lock",
    };
  }

  try {
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

  rehydrateReceiptFromCheckpoint(cp, cp);
  const jobOpts = {
    id: `${cp.id}_resume_${Date.now().toString(36)}`,
    receiptCollector: cp.receiptCollector || null,
    quotaHardCircuit: cp.quotaHardCircuit || null,
    quotaEscalate: cp.quotaEscalate || null,
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
  try {
    const { receiptFromCheckpoint } = await import("./checkpoint-restore-receipt.mjs");
    jobOpts.receiptCollector = receiptFromCheckpoint(cp);
    jobOpts.job = jobOpts.receiptCollector;
    jobOpts.quotaEscalate = jobOpts.receiptCollector.quotaEscalate;
  } catch {
    /* */
  }

  const resumeRetries =
    opts.retries ??
    cfg?.checkpoints?.resumeRetries ??
    (kind === "transport" ? 2 : 0);

  function isTransientResumeFailure(jobOrErr) {
    const msg = String(
      jobOrErr?.error || jobOrErr?.message || jobOrErr || ""
    );
    return /ECONNREFUSED|not healthy|not available|ETIMEDOUT|fetch failed|network|ECONNRESET|socket hang up|429|503|UND_ERR/i.test(
      msg
    );
  }

  async function runAgentOnce() {
    if (
      opts.useHarness === true ||
      (opts.useHarness !== false &&
        (kind === "grounding" || kind === "verify") &&
        cfg.harness)
    ) {
      try {
        const { runLongHarness } = await import("./long-harness.mjs");
        return await runLongHarness(jobOpts);
      } catch (harnessErr) {
        try {
          const j = await runJob(jobOpts);
          j.harnessFallback = harnessErr?.message || String(harnessErr);
          return j;
        } catch (jobErr) {
          const fail = {
            id: jobOpts.id,
            resumedFrom: cp.id,
            resumed: true,
            pass: false,
            status: "failed",
            code: RESUME_CODES.AGENT_FAILED,
            recoveryKind: kind,
            recoveryStrategy: plan.strategy,
            error: jobErr?.message || String(jobErr),
            harnessError: harnessErr?.message || String(harnessErr),
          };
          if (isTransientResumeFailure(jobErr) || isTransientResumeFailure(harnessErr)) {
            const e = new Error(fail.error);
            e.code = "TRANSIENT_RESUME";
            e.job = fail;
            throw e;
          }
          return fail;
        }
      }
    }
    try {
      return await runJob(jobOpts);
    } catch (err) {
      const fail = {
        id: jobOpts.id,
        resumedFrom: cp.id,
        resumed: true,
        pass: false,
        status: "failed",
        code: RESUME_CODES.AGENT_FAILED,
        recoveryKind: kind,
        recoveryStrategy: plan.strategy,
        error: err?.message || String(err),
      };
      if (isTransientResumeFailure(err)) {
        const e = new Error(fail.error);
        e.code = "TRANSIENT_RESUME";
        e.job = fail;
        throw e;
      }
      return fail;
    }
  }

  let job;
  const retryLog = [];
  try {
    if (resumeRetries > 0) {
      job = await withBackoff(
        async () => {
          const j = await runAgentOnce();
          if (j && j.pass === false && isTransientResumeFailure(j)) {
            const e = new Error(j.error || "transient resume failure");
            e.code = "TRANSIENT_RESUME";
            e.job = j;
            throw e;
          }
          return j;
        },
        {
          retries: resumeRetries,
          baseMs: opts.retryBaseMs ?? cfg?.checkpoints?.retryBaseMs ?? 400,
          maxDelayMs: opts.retryMaxDelayMs ?? 8_000,
          strategy: "full",
          shouldRetry: (err) =>
            err?.code === "TRANSIENT_RESUME" || isTransientResumeFailure(err),
          onRetry: (info) => {
            retryLog.push({
              attempt: info.attempt,
              delayMs: info.delayMs,
              error: info.error?.message || String(info.error),
            });
          },
        }
      );
      if (job && retryLog.length) job.resumeRetries = retryLog;
    } else {
      job = await runAgentOnce();
    }
  } catch (err) {
    job =
      err?.job ||
      {
        id: jobOpts.id,
        resumedFrom: cp.id,
        resumed: true,
        pass: false,
        status: "failed",
        code: RESUME_CODES.AGENT_FAILED,
        recoveryKind: kind,
        recoveryStrategy: plan.strategy,
        error: err?.message || String(err),
        resumeRetries: retryLog,
      };
  }

  job.resumedFrom = cp.id;
  job.recoveryStrategy = plan.strategy;
  job.recoveryKind = kind;

  try {
    await markCheckpointResumed(cfg, jobId, { resumedBy: job.id, status: "resumed" });
  } catch (markErr) {
    job.markResumedError = markErr?.message || String(markErr);
  }
  return job;
  } finally {
    await releaseResumeLock(jobId, cfg);
  }
}
