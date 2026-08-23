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
  let claimsGate = gateStructuredClaims({
    text: agentResult?.text || "",
    evidence: evidence?.snapshot?.() || evidence || [],
    cfg,
    opts: claimsOpts,
  });

  const softEnabled =
    opts.claimsSoftRetry !== false && cfg.jobs?.claimsSoftRetry !== false;

  while (
    softEnabled &&
    !claimsGate.refuse &&
    claimsGate.warnings?.length > 0 &&
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
          "Cite real tool evidence_ids; do not invent results. Warnings:\n- " +
          claimsGate.warnings.slice(0, 8).join("\n- "),
        cfg,
        workingDir: workspace,
        signal,
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
        if (rescue.toolTrace?.length && evidence?.fromToolTrace) {
          evidence.fromToolTrace(rescue.toolTrace);
        }
        claimsGate = gateStructuredClaims({
          text: agentResult.text,
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
    scoreClaimsAgainstEvidence(agentResult?.text || "", evidence?.snapshot?.() || [], {
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
