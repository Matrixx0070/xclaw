/**
 * W2 (30-day plan): runAgentLoop staged into composable, testable units.
 *
 * Stage 1 — turn pre-flight. Everything runAgentLoop decides BEFORE spending a
 * provider call on a turn: segment-boundary continuation, the per-run cost
 * governor, the daily/job cost budgets, and the unattended-operation caps.
 * The stage COMPUTES; the loop PERFORMS (event emission, checkpointing,
 * message pushes, flag flips stay in runAgentLoop). That split is what makes
 * the detectors testable with real recorded inputs — the audit's W2
 * acceptance — without forking the loop's side-effect semantics.
 *
 * Contract: returns { segment?, stop?, events } where
 *   segment — {segment, noticeText, event}: emit event, checkpoint, push the
 *             notice (never stops the run by itself);
 *   stop    — {cause, event, finalTextFallback, flags:{aborted,budgetStop},
 *              stampCost?}: emit event, apply flags, break the turn loop;
 *   events  — non-terminal events to emit in order (soft warns, check errors).
 * Evaluation order matches the historical inline code exactly:
 * segment → per-run governor → daily budget → job budget → run caps.
 */

/**
 * @param {object} inp
 * @param {number} inp.turns              zero-based turn index about to run
 * @param {number} inp.maxTurns           segment size
 * @param {number} inp.totalTurnCap      absolute cap across segments
 * @param {boolean} inp.continuationEnabled
 * @param {number} inp.toolCallCount     toolTrace.length so far
 * @param {number} inp.totalTokens      usage tracker total
 * @param {number|null} [inp.jobSpentUsd]
 * @param {boolean} [inp.costStrict]     cfg.cost?.strict — rethrow ledger errors
 * @param {() => {blocked?: boolean, reason?: string}} inp.costGovCheck
 *        per-run governor (throwing is swallowed, historical behavior)
 * @param {() => Promise<object>} inp.checkDailyBudget
 * @param {(spent: number) => object} [inp.checkJobBudget]
 * @param {{enabled: boolean, check: (u: {toolCalls: number, totalTokens: number}) => object|null}} inp.runBudget
 * @returns {Promise<{segment: object|null, stop: object|null, events: object[]}>}
 */
export async function evaluateTurnPreflight(inp) {
  const events = [];
  let segment = null;

  // Segment boundary: continuation notice + checkpoint (does not stop).
  if (
    inp.continuationEnabled &&
    inp.turns > 0 &&
    inp.turns % inp.maxTurns === 0
  ) {
    const seg = Math.floor(inp.turns / inp.maxTurns) + 1;
    segment = {
      segment: seg,
      event: {
        type: "segment",
        phase: "continue",
        segment: seg,
        turns: inp.turns,
        segmentSize: inp.maxTurns,
        cap: inp.totalTurnCap,
      },
      noticeText:
        `Turn checkpoint (${inp.turns}/${inp.totalTurnCap} turns used). ` +
        `The task is NOT finished — continue working toward the goal. Take the next ` +
        `concrete action; do not restart completed steps or stop to summarize.`,
    };
  }

  // Per-run cost governor (Trust Sprint): blocked → abort before the provider.
  try {
    const cg = inp.costGovCheck({ toolCalls: inp.toolCallCount });
    if (cg?.blocked) {
      return {
        segment,
        stop: {
          cause: "governor",
          event: { type: "cost", phase: "governor_blocked", ...cg },
          finalTextFallback: `COST_GOVERNOR: ${cg.reason}`,
          flags: { aborted: true, budgetStop: true },
          stampCost: cg,
        },
        events,
      };
    }
  } catch {
    /* governor errors never block a run (historical) */
  }

  // Daily + job cost budgets (ledger-backed; fail open unless cost.strict).
  try {
    const budget = await inp.checkDailyBudget();
    if (!budget.ok) {
      return {
        segment,
        stop: {
          cause: "daily_budget",
          event: {
            type: "cost",
            phase: "blocked",
            code: budget.code || "BUDGET_EXCEEDED",
            ...budget,
          },
          finalTextFallback: budget.message || "BUDGET_EXCEEDED",
          flags: { aborted: true, budgetStop: false },
        },
        events,
      };
    }
    if (budget.soft) {
      events.push({ type: "cost", phase: "soft_warn", ...budget });
    }
    if (inp.jobSpentUsd != null && inp.checkJobBudget) {
      const jobB = inp.checkJobBudget(inp.jobSpentUsd);
      if (!jobB.ok) {
        return {
          segment,
          stop: {
            cause: "job_budget",
            event: { type: "cost", phase: "blocked", ...jobB },
            finalTextFallback: jobB.message,
            flags: { aborted: true, budgetStop: false },
          },
          events,
        };
      }
    }
  } catch (e) {
    events.push({
      type: "cost",
      phase: "check_error",
      error: e?.message || String(e),
    });
    // Strict mode rethrows AFTER the caller has emitted the check_error event
    // (historical order) — returned as a marker instead of thrown here so the
    // event is never lost.
    if (inp.costStrict) {
      return { segment, stop: null, events, strictError: e };
    }
  }

  // Unattended-operation caps: graceful stop, post-run pipeline still runs.
  if (inp.runBudget?.enabled) {
    const bx = inp.runBudget.check({
      toolCalls: inp.toolCallCount,
      totalTokens: inp.totalTokens || 0,
    });
    if (bx) {
      return {
        segment,
        stop: {
          cause: "run_budget",
          event: { type: "budget", phase: "exceeded", ...bx },
          finalTextFallback: `Stopped: run budget exceeded (${bx.reason}: ${bx.used}/${bx.limit}).`,
          flags: { aborted: false, budgetStop: true },
        },
        events,
      };
    }
  }

  return { segment, stop: null, events };
}

export default { evaluateTurnPreflight };
