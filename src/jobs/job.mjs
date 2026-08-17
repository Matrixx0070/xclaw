/**
 * H1 — Job runtime: goal, budget, verify, evidence, status.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runAgentLoop } from "../agent/loop.mjs";
import { createEvidenceLog, flagUngroundedClaims, groundingShouldFail } from "./evidence.mjs";
import { scoreClaimsAgainstEvidence } from "./claims.mjs";
import { runVerifyChecks } from "./verify.mjs";
import { recordJob } from "./history.mjs";
import { rememberJob } from "../memory/durable.mjs";
import { proposeSkillFromFailure, proposeSkillFromSuccess } from "../skills/propose.mjs";
import { saveCheckpoint, saveMidRunCheckpoint } from "./checkpoint.mjs";
import { checkCostBudget, recordJobCost, estimateUsdFromUsage } from "../tokens/cost-governor.mjs";
import { checkSeatBudget, recordSeatUsage, seatsEnabled } from "../seats/manager.mjs";

/** @typedef {"pending"|"running"|"succeeded"|"failed"|"cancelled"|"budget_exceeded"} JobStatus */

/**
 * @param {object} opts
 * @param {string} opts.goal
 * @param {object} opts.cfg
 * @param {string} [opts.workspace]
 * @param {object[]} [opts.verify]
 * @param {number} [opts.maxTurns]
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @param {(e: object) => void} [opts.onEvent]
 */
export async function runJob(opts) {
  const {
    goal,
    cfg,
    verify = [],
    maxTurns = cfg.agent?.maxTurns ?? 12,
    timeoutMs = 180_000,
    signal,
    onEvent = () => {},
  } = opts;

  const id = opts.id || `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const workspace =
    opts.workspace ||
    path.join(os.tmpdir(), "xclaw-jobs", id);

  await fs.mkdir(workspace, { recursive: true });

  const evidence = createEvidenceLog();

  // Cost governor pre-check
  try {
    if (cfg) {
      const budget = await checkCostBudget(cfg);
      if (!budget.ok) {
        return {
          id,
          goal,
          workspace,
          status: "failed",
          pass: false,
          turns: 0,
          toolCalls: 0,
          toolErrors: 0,
          wallMs: 0,
          text: "",
          error: budget.message || "cost hard cap",
          code: budget.code || "BUDGET_EXCEEDED",
          costBlocked: true,
          evidence: [],
        };
      }
    }
  } catch {
    /* */
  }

  // Seat budget pre-check (Phase 3)
  let seatInfo = null;
  try {
    if (cfg && seatsEnabled(cfg)) {
      const peer = opts.peer || opts.seatPeer || opts.from || null;
      seatInfo = await checkSeatBudget(cfg, peer);
      if (!seatInfo.ok) {
        return {
          id,
          goal,
          workspace,
          status: "failed",
          pass: false,
          turns: 0,
          toolCalls: 0,
          toolErrors: 0,
          wallMs: 0,
          text: "",
          error: seatInfo.message || "seat hard cap",
          seatBlocked: true,
          seat: seatInfo.seat || null,
          evidence: [],
        };
      }
    }
  } catch {
    /* */
  }

  let groundWarn = [];
  let groundingFailed = false;
  let claimScore = null;
  const started = Date.now();
  /** @type {JobStatus} */
  let status = "running";
  const events = [];
  const push = (e) => {
    events.push(e);
    onEvent(e);
  };

  push({ type: "job", phase: "start", id, goal, workspace });

  let agentResult = null;
  let verifyResult = null;
  let error = null;
  const midToolTrace = [];

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener?.("abort", onAbort);
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  // Eval / job profile: often auto-approve tools inside sandbox
  const jobCfg = {
    ...cfg,
    agent: { ...(cfg.agent || {}), maxTurns },
    security: {
      ...(cfg.security || {}),
      autoApprove: opts.autoApprove ?? cfg.security?.autoApprove ?? true,
    },
  };

  try {
    agentResult = await runAgentLoop({
      userMessage: goal,
      cfg: jobCfg,
      workingDir: workspace,
      signal: ac.signal,
      systemNotes: opts.systemNotes || jobCfg.agent?.systemNotes,
      sessionId: opts.sessionId || (opts.persistRun ? id : undefined),
      persistRun: opts.persistRun,
      onEvent: (e) => {
        push(e);
        if (e.type === "tool" && e.phase === "end") {
          evidence.add({
            source: "tool",
            summary: `${e.name}: ${e.preview || ""}`,
          });
          midToolTrace.push({
            name: e.name,
            preview: e.preview,
            at: new Date().toISOString(),
          });
        }
        // Mid-run checkpoint every N model turns
        if (e.type === "model" && e.phase === "request" && cfg && e.turn) {
          const every = Number(
            opts.checkpointEveryTurns ??
              cfg.harness?.checkpointEveryTurns ??
              cfg.jobs?.checkpointEveryTurns ??
              3
          );
          if (every > 0 && e.turn > 1 && (e.turn - 1) % every === 0) {
            const turnDone = e.turn - 1;
            saveMidRunCheckpoint(cfg, {
              id,
              goal,
              workspace,
              turns: turnDone,
              maxTurns,
              toolTrace: midToolTrace.slice(-20),
              evidence: evidence.snapshot(),
              text: "",
              status: "running",
            })
              .then((fp) => {
                push({
                  type: "job",
                  phase: "checkpoint",
                  turn: turnDone,
                  path: fp,
                });
              })
              .catch((err) => {
                push({
                  type: "job",
                  phase: "checkpoint_error",
                  error: err?.message || String(err),
                });
              });
          }
        }
      },
    });

    if (agentResult.toolTrace?.length) {
      evidence.fromToolTrace(agentResult.toolTrace);
    }

    const turns = agentResult.turns ?? 0;
    if (turns >= maxTurns && verify.length) {
      // still verify — may have succeeded on last turn
    }

    verifyResult = await runVerifyChecks(workspace, verify);
    for (const r of verifyResult.results) {
      evidence.add({
        source: "verify",
        summary: `verify ${r.type}${r.path ? " " + r.path : ""} → ${r.pass ? "pass" : "fail"}${r.detail ? " (" + r.detail + ")" : ""}`,
      });
    }

    const groundHard = Boolean(opts.groundHard || opts.groundingHard || cfg.jobs?.groundHard);
    groundWarn = flagUngroundedClaims(agentResult.text, evidence.snapshot(), { hard: groundHard });
    for (const w of groundWarn) {
      evidence.add({ source: "system", summary: `grounding: ${w}` });
    }
    claimScore = scoreClaimsAgainstEvidence(
      agentResult.text,
      evidence.snapshot(),
      {
        hard: groundHard || opts.claimsRequireEvidence,
        requireStructured: Boolean(opts.requireStructuredClaims),
      }
    );
    for (const w of claimScore.warnings) {
      evidence.add({ source: "system", summary: `claim: ${w}` });
      groundWarn.push(w);
    }
    if (
      groundingShouldFail(groundWarn, { hard: groundHard }) ||
      ((groundHard || opts.claimsRequireEvidence) && !claimScore.ok)
    ) {
      groundingFailed = true;
      status = "failed";
      error = error || groundWarn[0] || "grounding/claim hard fail";
      evidence.add({ source: "system", summary: "grounding hard fail" });
    }

    if (groundingFailed) {
      status = "failed";
    } else if (ac.signal.aborted && !verifyResult.ok) {
      status = signal?.aborted ? "cancelled" : "budget_exceeded";
    } else if (verify.length && !verifyResult.ok) {
      status = "failed";
    } else if (verify.length && verifyResult.ok) {
      status = "succeeded";
    } else {
      const critical = events.some((e) => e.type === "guard" && e.level === "critical");
      status = critical ? "failed" : "succeeded";
    }
  } catch (err) {
    error = err.message || String(err);
    status = ac.signal.aborted ? (signal?.aborted ? "cancelled" : "budget_exceeded") : "failed";
    push({ type: "job", phase: "error", error });
    // Surface transport failures clearly for operators
    if (/ECONNREFUSED|not available|not healthy/i.test(error)) {
      evidence.add({ source: "system", summary: `computer: ${error}` });
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }

  const finished = Date.now();
  const job = {
    id,
    goal,
    workspace,
    status,
    pass: status === "succeeded",
    turns: agentResult?.turns ?? 0,
    toolCalls: agentResult?.toolTrace?.length ?? 0,
    toolErrors: (agentResult?.toolTrace || []).filter((t) => t.blocked || /error|fail/i.test(String(t.result || ""))).length,
    wallMs: finished - started,
    text: agentResult?.text || "",
    toolTrace: agentResult?.toolTrace || [],
    verify: verifyResult,
    evidence: evidence.snapshot(),
    groundingWarnings: groundWarn,
    groundingFailed,
    claimScore,
    usage: agentResult?.usage || null,
    error,
    model: agentResult?.model,
    maxTurns,
    events: events.filter((e) => e.type === "job" || e.type === "guard" || e.type === "retry"),
  };

  push({ type: "job", phase: "end", id, status, pass: job.pass, wallMs: job.wallMs });

  // Global history (~/.xclaw/jobs) when cfg available
  try {
    if (cfg) await recordJob(cfg, job);
  } catch {
    /* non-fatal */
  }
  try {
    if (cfg) await rememberJob(cfg, job);
  } catch {
    /* non-fatal */
  }
  try {
    if (cfg) await saveCheckpoint(cfg, job);
  } catch {
    /* non-fatal */
  }
  try {
    if (cfg) {
      const usd =
        job.usage?.costUsd ??
        estimateUsdFromUsage(job.usage, cfg) ??
        0;
      job.costUsd = usd;
      await recordJobCost(cfg, { usd, jobId: job.id });
      if (seatsEnabled(cfg)) {
        const peer = opts.peer || opts.seatPeer || opts.from || null;
        const tok =
          job.usage?.totalTokens ??
          ((job.usage?.promptTokens || 0) + (job.usage?.completionTokens || 0) || 0);
        await recordSeatUsage(cfg, peer, { usd, tokens: tok, jobId: job.id });
      }
    }
  } catch {
    /* non-fatal */
  }

  // Phase F: promote failures to skill proposals (review-only)
  if (cfg && job && !job.pass && cfg.skills?.proposeOnFail !== false) {
    try {
      const prop = await proposeSkillFromFailure(cfg, {
        caseId: job.id,
        goal: job.goal,
        failures: [
          job.error,
          ...(job.verify?.results || [])
            .filter((r) => !r.pass)
            .map((r) => `${r.type}:${r.path || r.cmd || ""}`),
        ].filter(Boolean),
        text: job.text,
        toolTrace: job.toolTrace,
      });
      job.proposal = prop.path;
      try {
        await rememberJob(cfg, job, { proposal: prop.path });
      } catch {
        /* */
      }
    } catch {
      /* non-fatal */
    }
  }

  
  // R5: learn from success (review-only skill draft + preference hints)
  if (cfg && job && job.pass && cfg.skills?.proposeOnSuccess !== false) {
    try {
      const prop = await proposeSkillFromSuccess(cfg, {
        caseId: job.id || job.caseId,
        goal: job.goal || opts.goal,
        text: job.text,
        toolTrace: job.toolTrace || job.tools || [],
      });
      if (prop?.ok) job.successProposal = prop.path || prop.name;
    } catch (e) {
      console.warn("[xclaw] proposeOnSuccess:", e.message);
    }
    try {
      const { extractPreferenceHints, writePreferences } = await import("../memory/preferences.mjs");
      const hints = extractPreferenceHints(job.text || "");
      if (hints.length) {
        const w = await writePreferences(cfg, hints, { source: job.id || "job" });
        if (w.written) job.preferencesWritten = w.written;
      }
    } catch (e) {
      console.warn("[xclaw] preference write-back:", e.message);
    }
  }

  return job;
}

/**
 * Persist job summary under workspace/.xclaw/jobs/
 */
export async function saveJobSummary(job) {
  const dir = path.join(job.workspace, ".xclaw", "jobs");
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, `${job.id}.json`);
  const slim = { ...job, events: job.events, toolTrace: (job.toolTrace || []).map((t) => ({
    name: t.name,
    args: t.args,
    result: String(t.result || "").slice(0, 500),
  })) };
  await fs.writeFile(fp, JSON.stringify(slim, null, 2));
  return fp;
}
