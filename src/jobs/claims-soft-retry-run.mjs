/**
 * runJob claims gate + soft-retry with budget stamping.
 */
import { gateStructuredClaims } from "../agent/claims-gate.mjs";
import {
  createClaimsSoftRetryBudget,
  stampClaimsSoftRetryOnJob,
} from "../agent/claims-soft-retry.mjs";
import { stampReceiptMetrics } from "./receipt-metrics.mjs";
import { scoreClaimsAgainstEvidence } from "./claims.mjs";

/**
 * Gate agent text; optionally soft-retry once (or up to budget.max) via runAgentLoop.
 */
export async function runClaimsGateWithSoftRetry(ctx = {}) {
  const {
    agentResult: initial,
    evidence,
    cfg = {},
    opts = {},
    push = () => {},
    runAgentLoop,
    workspace,
    signal,
  } = ctx;

  let agentResult = initial;
  const claimsOpts = {
    groundHard: Boolean(opts.groundHard || opts.groundingHard || cfg.jobs?.groundHard),
    claimsRequireEvidence: opts.claimsRequireEvidence ?? cfg.jobs?.claimsRequireEvidence,
    requireStructuredClaims: opts.requireStructuredClaims ?? cfg.jobs?.requireStructuredClaims,
    claimsSoftRetry: opts.claimsSoftRetry,
    claimsSoftRetryMax: opts.claimsSoftRetryMax,
  };

  const budget = createClaimsSoftRetryBudget({ cfg, ...claimsOpts });
  // Score the RAW final text (with the claims scaffold). The loop strips the
  // block from its presentation `text`, so gating on `text` failed compliant
  // answers for the runtime's own strip (2026-08-23 soak nights 1–2).
  let gateText = agentResult?.finalText ?? agentResult?.text ?? "";
  let claimsGate = gateStructuredClaims({
    text: gateText,
    evidence: evidence?.snapshot?.() || evidence || [],
    cfg,
    opts: claimsOpts,
  });

  const softEnabled =
    opts.claimsSoftRetry !== false && cfg.jobs?.claimsSoftRetry !== false;

  // A refusing gate is EXACTLY what the soft retry exists for: the dominant
  // refusal in practice is "missing structured claims JSON block" on a job
  // whose work already verified (2026-08-23 soak night 1 — two campaign jobs
  // hard-failed with the retry budget sitting unused because this loop
  // demanded !refuse). The retry stays bounded by the budget, and the re-gate
  // still scores restated claims against real evidence, so fabrication cannot
  // pass by retrying — it only gets one bounded chance to restate honestly.
  while (
    softEnabled &&
    (claimsGate.refuse || claimsGate.warnings?.length > 0) &&
    budget.remaining > 0 &&
    typeof runAgentLoop === "function"
  ) {
    const rec = budget.record({ warnings: claimsGate.warnings });
    if (!rec.ok) break;

    evidence?.add?.({
      source: "system",
      summary: `claims soft warnings (retry ${rec.used}/${rec.max}): ${claimsGate.warnings.slice(0, 3).join("; ")}`,
    });
    push({
      type: "job",
      phase: "claims_soft_retry",
      warnings: claimsGate.warnings.slice(0, 5),
      softRetryBudget: rec,
    });

    try {
      const rescue = await runAgentLoop({
        // Bounded rescue sub-run — never auto-continue.
        continuation: false,
        userMessage:
          (opts.goal || opts.message || "") +
          "\n\n[XClaw claims soft retry] Prior answer had grounding warnings. " +
          "Restate your final answer and END it with the structured block " +
          '```json {"claims":[...],"evidence_ids":[...]}``` citing real tool ' +
          "evidence_ids; do not invent results. Warnings:\n- " +
          claimsGate.warnings.slice(0, 8).join("\n- "),
        cfg,
        workingDir: workspace,
        signal,
        onEvent: (e) => push(e),
        stream: false,
        history: [],
        rescuePrompt: true,
      });
      if (rescue?.text || rescue?.finalText) {
        gateText = rescue.finalText ?? rescue.text;
        agentResult = {
          ...agentResult,
          text: rescue.text,
          finalText: rescue.finalText ?? rescue.text,
          toolTrace: [
            ...(agentResult.toolTrace || []),
            ...(rescue.toolTrace || []),
          ],
          turns: (agentResult.turns || 0) + (rescue.turns || 0),
        };
        if (rescue.toolTrace?.length && evidence?.fromToolTrace) {
          evidence.fromToolTrace(rescue.toolTrace);
        }
        claimsGate = gateStructuredClaims({
          text: gateText,
          evidence: evidence?.snapshot?.() || [],
          cfg,
          opts: claimsOpts,
        });
      }
    } catch (retryErr) {
      evidence?.add?.({
        source: "system",
        summary: `claims soft retry error: ${retryErr?.message || retryErr}`,
      });
      break;
    }
  }

  const claimScore =
    claimsGate.score ||
    scoreClaimsAgainstEvidence(gateText, evidence?.snapshot?.() || [], {
      hard: claimsGate.policy?.hard,
      requireStructured: claimsGate.policy?.requireStructured,
    });
  const groundWarn = [...(claimsGate.warnings || [])];
  for (const w of groundWarn) {
    evidence?.add?.({ source: "system", summary: `grounding: ${w}` });
  }

  const groundingFailed = Boolean(claimsGate.refuse);
  if (groundingFailed) {
    evidence?.add?.({ source: "system", summary: "grounding hard fail (claims-gate)" });
  }

  const softRetryBudget = budget.snapshot();
  claimsGate = { ...claimsGate, softRetryBudget };

  return {
    agentResult,
    claimsGate,
    groundWarn,
    claimScore,
    groundingFailed,
    softRetryBudget,
    error: groundingFailed ? claimsGate.reason || groundWarn[0] : null,
  };
}

export function stampJobClaimsSoftRetry(job, softRetryBudget, claimsGate) {
  if (!job) return job;
  if (softRetryBudget) {
    stampClaimsSoftRetryOnJob(job, softRetryBudget);
  }
  if (claimsGate) {
    job.claimsGate = claimsGate;
  }
  stampReceiptMetrics(job);
  return job;
}

export default { runClaimsGateWithSoftRetry, stampJobClaimsSoftRetry };
