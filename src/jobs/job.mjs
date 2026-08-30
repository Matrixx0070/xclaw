/**
 * H1 — Job runtime: goal, budget, verify, evidence, status.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runAgentLoop } from "../agent/loop.mjs";
import { createEvidenceLog } from "./evidence.mjs";
import { scoreClaimsAgainstEvidence } from "./claims.mjs";
import { runClaimsGateWithSoftRetry, stampJobClaimsSoftRetry } from "./claims-soft-retry-run.mjs";
import { resolveClaimsPolicy } from "../agent/claims-gate.mjs";
import { runVerifyChecks } from "./verify.mjs";
import { recordJob } from "./history.mjs";
import { stampJobToolHash } from "./stamp-tool-hash.mjs";
import { rememberJob } from "../memory/durable.mjs";
import { attachReceiptCollectorToJob, ensureJobReceiptCollector } from "./finalize-receipt.mjs";
import { proposeSkillFromFailure, proposeSkillFromSuccess } from "../skills/propose.mjs";
import { saveCheckpoint, saveMidRunCheckpoint } from "./checkpoint.mjs";
import { recordJobCost, estimateUsdFromUsage } from "../tokens/cost-governor.mjs";
import { reserveUsd, settleUsd } from "../tokens/swarm-ledger.mjs";
import { stampCostHardBlock } from "../tokens/cost-hard-block.mjs";
import { recordSeatUsage, seatsEnabled } from "../seats/manager.mjs";
import { preflightJobBudgets, budgetBlockedJob } from "./job-dual-preflight.mjs";
import { createReceiptCollector, copyCollectorOntoJob } from "./receipt-collector.mjs";

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

// The base system prompt only says to PREFER the structured claims block, but
// jobs gated by requireStructuredClaims hard-fail without one — the model was
// never told the block is mandatory (2026-08-23 soak night 1: two campaign
// jobs completed verified work, answered correctly, omitted the block, and
// hard-failed). When the resolved claims policy requires the block, say so.
const REQUIRED_CLAIMS_NOTE =
  "MANDATORY: end your final answer with a structured claims block:\n" +
  '```json\n{"claims":["short factual claim"],"evidence_ids":["tool name or evidence id"]}\n```\n' +
  "Only claim actions supported by tool results in this run. " +
  "A final answer without this block fails the job.";

export function buildJobSystemNotes(opts, jobCfg, cfg) {
  const base = opts.systemNotes || jobCfg.agent?.systemNotes;
  const notes = Array.isArray(base) ? [...base] : base ? [base] : [];
  if (resolveClaimsPolicy(cfg, opts).requireStructured) {
    notes.push(REQUIRED_CLAIMS_NOTE);
  }
  return notes;
}

export async function runJob(opts) {
  const {
    goal,
    cfg,
    verify = [],
    maxTurns = cfg.agent?.maxTurns ?? 12,
    timeoutMs = 180_000,
    signal,
    onEvent = () => {},
    persistRun = true,
  } = opts;

  const id = opts.id || `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const workspace =
    opts.workspace ||
    path.join(os.tmpdir(), "xclaw-jobs", id);

  await fs.mkdir(workspace, { recursive: true });

  const evidence = createEvidenceLog();

  // Dual preflight: auth refresh -> cost governor -> seat budget
  let seatInfo = null;
  try {
    const dual = await preflightJobBudgets(cfg, opts);
    if (dual && dual.ok === false) {
      const denied = budgetBlockedJob({ id, goal, workspace, r: dual });
      // keep the n10 cost-hard-block stamp: budgetBlockedJob does not do it,
      // and the quota hard circuit + history readers depend on it.
      if (denied.costBlocked) {
        try {
          await stampCostHardBlock(denied, dual.cost || dual);
        } catch {
          /* stamping is best-effort */
        }
      }
      return denied;
    }
    seatInfo = dual?.seat || null;
  } catch {
    /* */
  }

  // Swarm children draw on a shared daily ledger: reserve before the run so a
  // fan-out cannot collectively blow the cap, settle the real spend after.
  let swarmReserved = 0;
  if (cfg && opts.swarmId) {
    const want = Math.max(0, Number(opts.reserveUsd ?? opts.estimateUsd ?? 0) || 0);
    const res = reserveUsd(cfg, {
      swarmId: opts.swarmId,
      childId: opts.childId || id,
      usd: want,
      leaseOwner: opts.leaseOwner || null,
    });
    if (res && res.ok === false) {
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
        error: res.message || "swarm ledger hard cap",
        code: res.code || "SWARM_LEDGER_HARD_CAP",
        costBlocked: true,
        swarmLedger: res,
        evidence: [],
      };
    }
    swarmReserved = want;
  }

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
  // Claims-gate outputs. These declarations were dropped by 0bf1d69
  // (2026-08-19) — since then EVERY runJob threw
  // "ReferenceError: groundWarn is not defined" at job construction (strict
  // ESM), killing the /job path silently: no test drove runJob end-to-end.
  let groundWarn = [];
  let groundingFailed = false;
  let claimScore = null;
  let claimsGate = null;
  let softRetryBudget = null;
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

  // Always-on receipt collector so force-stop still persists quotaHardCircuit;
  // seeded from opts.receiptCollector when a caller supplies one.
  const receiptCollector = ensureJobReceiptCollector(
    { id },
    opts.receiptCollector || opts.collector || createReceiptCollector()
  );
  try {
    agentResult = await runAgentLoop({
      userMessage: goal,
      // Jobs manage their own budget/verdict; a cutoff persists as an
      // honest "incomplete" verdict instead of silently quadrupling turns.
      continuation: false,
      cfg: jobCfg,
      workingDir: workspace,
      job: receiptCollector,
      receiptCollector,
      // Injection seam (tests / callers with a pre-resolved provider) — the
      // loop already accepts one and resolves from cfg when absent.
      provider: opts.provider,
      signal: ac.signal,
      ledgerIds: { jobId: id },
      systemNotes: buildJobSystemNotes(opts, jobCfg, cfg),
      // Jobs persist their run snapshot by default: every job already has a
      // durable id, and the snapshot is what makes `xclaw runs` and resume
      // usable. Callers opt out with persistRun:false.
      sessionId: opts.sessionId || (persistRun ? id : undefined),
      persistRun,
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
              quotaEscalate: (typeof receiptCollector !== "undefined" && receiptCollector.quotaEscalate) || null,
              claimsSoftRetry: (typeof receiptCollector !== "undefined" && receiptCollector.claimsSoftRetry) || null,
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
    const gateOut = await runClaimsGateWithSoftRetry({
      agentResult,
      evidence,
      cfg,
      opts,
      push,
      runAgentLoop,
      workspace,
      signal: ac.signal,
    });
    agentResult = gateOut.agentResult || agentResult;
    claimsGate = gateOut.claimsGate;
    claimScore = gateOut.claimScore;
    groundWarn = gateOut.groundWarn || [];
    softRetryBudget = gateOut.softRetryBudget || null;
    if (gateOut.groundingFailed) {
      groundingFailed = true;
      status = "failed";
      error = error || gateOut.error || "grounding/claim hard fail";
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
      // No verify commands: success cannot be EARNED, so derive honesty from
      // how the run actually ended. A runtime cutoff (maxTurns, pending
      // approval, guard, budget) is never evidence the goal was met — those
      // jobs are INCOMPLETE, not succeeded (they were previously recorded as
      // succeeded and written to durable memory as job_ok).
      const critical = events.some((e) => e.type === "guard" && e.level === "critical");
      const sr = agentResult?.stopReason || "natural";
      const modelEnded = sr === "natural" || sr === "hook";
      // The loop refused a false "Done." — that is failure, not a cutoff.
      if (sr === "unverified") status = "failed";
      else status = critical ? "failed" : modelEnded ? "succeeded" : "incomplete";
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
    // Verdict provenance: how "succeeded" was established. "verified" is
    // earned by deterministic verify commands; "unverified" is the model's
    // own account with no independent check — consumers (memory, skill
    // promotion) must treat those differently.
    verdict:
      verify.length && verifyResult?.ok
        ? "verified"
        : verify.length
          ? "failed"
          : status === "succeeded"
            ? "unverified"
            : status,
    stopReason: agentResult?.stopReason || null,
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
    claimsGate,
    claimScore,
    usage: agentResult?.usage || null,
    error,
    model: agentResult?.model,
    maxTurns,
    events: events.filter((e) => e.type === "job" || e.type === "guard" || e.type === "retry"),
  };
  copyCollectorOntoJob(job, receiptCollector);
  stampJobToolHash(job);
  stampJobClaimsSoftRetry(job, softRetryBudget, claimsGate);
  job.receiptCollector = job.receiptCollector || receiptCollector;
  attachReceiptCollectorToJob(job, {
    agentResult,
    collector: receiptCollector,
  });

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
      if (opts.swarmId && swarmReserved >= 0) {
        try {
          job.swarmLedger = settleUsd(cfg, {
            swarmId: opts.swarmId,
            childId: opts.childId || job.id,
            usd,
          });
        } catch {
          /* ledger settle is best-effort */
        }
      }
      // NOTE: no recordJobCost here anymore — the agent loop itself feeds
      // the daily governor for every run now; recording again here would
      // double-count job traffic.
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

  // R5: learn from success (review-only skill draft + preference hints).
  // Only VERIFIED successes may seed skills — a model-self-declared pass is
  // not evidence the approach worked (audit 2026-08-23).
  if (cfg && job && job.pass && job.verdict === "verified" && cfg.skills?.proposeOnSuccess !== false) {
    try {
      const prop = await proposeSkillFromSuccess(cfg, {
        caseId: job.id || job.caseId,
        verdict: job.verdict,
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
