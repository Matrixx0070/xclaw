/**
 * H1 — Job runtime: goal, budget, verify, evidence, status.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runAgentLoop } from "../agent/loop.mjs";
import { createEvidenceLog } from "./evidence.mjs";
import { scoreClaimsAgainstEvidence } from "./claims.mjs";
import { gateStructuredClaims } from "../agent/claims-gate.mjs";
import { runVerifyChecks } from "./verify.mjs";
import { recordJob } from "./history.mjs";
import { stampJobToolHash } from "./stamp-tool-hash.mjs";
import { rememberJob } from "../memory/durable.mjs";
import { attachReceiptCollectorToJob } from "./finalize-receipt.mjs";
import { proposeSkillFromFailure, proposeSkillFromSuccess } from "../skills/propose.mjs";
import { saveCheckpoint, saveMidRunCheckpoint } from "./checkpoint.mjs";
import { checkCostBudget, recordJobCost, estimateUsdFromUsage } from "../tokens/cost-governor.mjs";
import { stampCostHardBlock } from "../tokens/cost-hard-block.mjs";
import { checkSeatBudget, recordSeatUsage, seatsEnabled } from "../seats/manager.mjs";
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

  // Cost governor pre-check
  try {
    if (cfg) {
      const budget = await checkCostBudget(cfg);
      if (!budget.ok) {
        const denied = {
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
        await stampCostHardBlock(denied, budget);
        return denied;
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
  let claimsGate = null;
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

  const receiptCollector = createReceiptCollector();
  try {
    agentResult = await runAgentLoop({
      userMessage: goal,
      cfg: jobCfg,
      workingDir: workspace,
      job: receiptCollector,
      receiptCollector,
      signal: ac.signal,
      ledgerIds: { jobId: id },
      systemNotes: opts.systemNotes || jobCfg.agent?.systemNotes,
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
    const claimsOpts = {
      groundHard,
      claimsRequireEvidence: opts.claimsRequireEvidence ?? cfg.jobs?.claimsRequireEvidence,
      requireStructuredClaims: opts.requireStructuredClaims ?? cfg.jobs?.requireStructuredClaims,
    };
    claimsGate = gateStructuredClaims({
      text: agentResult.text,
      evidence: evidence.snapshot(),
      cfg,
      opts: claimsOpts,
    });
    const softRetry =
      !claimsGate.refuse &&
      claimsGate.warnings?.length > 0 &&
      opts.claimsSoftRetry !== false &&
      cfg.jobs?.claimsSoftRetry !== false;
    if (softRetry) {
      evidence.add({
        source: "system",
        summary: `claims soft warnings (retry once): ${claimsGate.warnings.slice(0, 3).join("; ")}`,
      });
      push({ type: "job", phase: "claims_soft_retry", warnings: claimsGate.warnings.slice(0, 5) });
      try {
        const rescue = await runAgentLoop({
          userMessage:
            (opts.goal || opts.message || "") +
            "\n\n[XClaw claims soft retry] Prior answer had grounding warnings. " +
            "Cite real tool evidence_ids; do not invent results. Warnings:\n- " +
            claimsGate.warnings.slice(0, 8).join("\n- "),
          cfg,
          workingDir: workspace,
          signal: ac.signal,
          onEvent: (e) => push(e),
          stream: false,
          history: [],
          rescuePrompt: true,
        });
        if (rescue?.text) {
          agentResult = {
            ...agentResult,
            text: rescue.text,
            toolTrace: [
              ...(agentResult.toolTrace || []),
              ...(rescue.toolTrace || []),
            ],
            turns: (agentResult.turns || 0) + (rescue.turns || 0),
          };
          if (rescue.toolTrace?.length) evidence.fromToolTrace(rescue.toolTrace);
          claimsGate = gateStructuredClaims({
            text: agentResult.text,
            evidence: evidence.snapshot(),
            cfg,
            opts: claimsOpts,
          });
        }
      } catch (retryErr) {
        evidence.add({
          source: "system",
          summary: `claims soft retry error: ${retryErr?.message || retryErr}`,
        });
      }
    }
    claimScore = claimsGate.score || scoreClaimsAgainstEvidence(
      agentResult.text,
      evidence.snapshot(),
      { hard: claimsGate.policy?.hard, requireStructured: claimsGate.policy?.requireStructured }
    );
    groundWarn = [...(claimsGate.warnings || [])];
    for (const w of groundWarn) {
      evidence.add({ source: "system", summary: `grounding: ${w}` });
    }
    if (claimsGate.refuse) {
      groundingFailed = true;
      status = "failed";
      error = error || claimsGate.reason || groundWarn[0] || "grounding/claim hard fail";
      evidence.add({ source: "system", summary: "grounding hard fail (claims-gate)" });
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
  attachReceiptCollectorToJob(job, {
    agentResult,
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
