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

/**
 * Stage 2a — pairing-invariant backfill plan. EVERY tool_call id in an
 * assistant turn must get a tool message: a mid-batch stop (pending approval,
 * guard critical) skips the remaining calls, and an orphaned tool_use makes
 * the next Anthropic request fail with HTTP 400 ("tool_use ids were found
 * without tool_result blocks"). Pure: given the turn's calls and the message
 * list, returns the skip event + tool-message content for every orphan, in
 * call order. The loop pushes the messages and emits the events.
 *
 * @param {Array<{id?: string, function?: {name?: string}}>} calls
 * @param {Array<{role: string, tool_call_id?: string}>} messages
 * @returns {Array<{callId: string, name: string|undefined, event: object, content: string}>}
 */
export function planPairingBackfill(calls, messages) {
  const answered = new Set(
    messages
      .filter((m) => m.role === "tool" && m.tool_call_id)
      .map((m) => m.tool_call_id)
  );
  const out = [];
  for (const call of calls || []) {
    if (!call?.id || answered.has(call.id)) continue;
    out.push({
      callId: call.id,
      name: call.function?.name,
      event: {
        type: "tool",
        phase: "skipped",
        name: call.function?.name,
        callId: call.id,
        reason: "turn_stopped",
      },
      content: "Not executed — the turn stopped before this tool call ran.",
    });
  }
  return out;
}

/**
 * Stage 2b — why the run ended, computed once from the loop's terminal flags.
 * Orchestrators must distinguish "the model finished" from "the runtime cut
 * it off" (a turn cap is an execution constraint, never evidence the user's
 * objective is complete). Priority order is a contract — earlier causes win.
 *
 * @param {object} f terminal flags
 * @returns {"aborted"|"hook"|"guard"|"approval"|"policy"|"budget"|"maxTurns"|"natural"}
 */
export function computeStopReason(f) {
  if (f.signalAborted || f.aborted) return "aborted";
  if (f.hookAbort) return "hook";
  if (f.loopGuardStop) return "guard";
  if (f.lastPendingApproval) return "approval";
  if (f.toolHaltStop) return "policy";
  if (f.budgetStop) return "budget";
  if (f.maxTurnsStop) return "maxTurns";
  return "natural";
}

/**
 * Honest terminal state for the durable snapshot: "completed" is reserved for
 * runs the model actually finished — a cutoff persists AS its stopReason so
 * restart recovery can tell resumable work from done work.
 * @param {string} stopReason
 */
export function terminalStatus(stopReason) {
  return stopReason === "natural" || stopReason === "hook"
    ? "completed"
    : stopReason;
}

/**
 * Stage 3 — final-answer rescue plan. Hitting the turn budget mid-work used to
 * discard EVERYTHING (live: a 5-node research swarm returned 0/5 ballots).
 * The plan is pure: whether to rescue, the no-tools rescue message (an
 * orchestrated segment overrides it — a segment boundary wants the mission
 * state block, not a user-facing answer), how a rescued answer is stamped,
 * and the stub when no rescue lands. The loop makes the provider call.
 *
 * @param {object} inp
 * @param {object} [inp.cfg]
 * @param {string|null} [inp.rescuePrompt]
 * @param {number} inp.totalTurnCap
 */
export function planFinalAnswerRescue(inp) {
  return {
    enabled: inp.cfg?.agent?.finalAnswerRescue !== false,
    userMessage: {
      role: "user",
      content:
        inp.rescuePrompt ||
        "Turn budget exhausted — no more tool calls are possible. " +
          "Produce your final answer NOW from the work above. If you were asked " +
          "for structured output (ballot, JSON, verdict), emit it based on what " +
          "you found so far; state clearly what remains unverified.",
    },
    formatRescuedText: (text) =>
      `${text}\n\n_[stopped at turn cap ${inp.totalTurnCap}; this is a best-effort final answer]_`,
    stubText: `Stopped after ${inp.totalTurnCap} turns (turn cap).`,
  };
}

/**
 * Stage 4a — tool-call intake. Parse the model's JSON arguments (malformed
 * JSON degrades to {}, historical) and pin exec plans to the loop's
 * workingDir so subagent/swarm isolates cannot drift (only when the model
 * supplied neither cwd nor workingDir).
 * @param {{function?: {arguments?: string}}} call
 * @param {string|null|undefined} workingDir
 */
export function parseToolCallArgs(call, workingDir) {
  let args = {};
  try {
    args = JSON.parse(call.function?.arguments || "{}");
  } catch {
    args = {};
  }
  if (workingDir && args.cwd == null && args.workingDir == null) {
    args = { ...args, cwd: workingDir };
  }
  return args;
}

/**
 * Stage 4b — run-scoped allowlist verdict. Excluded tools are never
 * advertised, but a hallucinated name must not reach the router either
 * (defense in depth). Pure: null when allowed; otherwise the block plan
 * (message, event, trace policy) the loop applies.
 * @param {string|undefined} name
 * @param {{match: (n: string) => boolean}|null|undefined} toolFilter
 */
export function evaluateRunAllowlist(name, toolFilter) {
  if (!toolFilter || toolFilter.match(name)) return null;
  return {
    message: `Tool ${name} is not available in this run (allowTools).`,
    event: { type: "tool", phase: "blocked", name, reason: "allowTools" },
    policy: { phase: "filter", decision: "deny", reason: "allowTools" },
  };
}

/**
 * Stage 4c — TOCTOU plan re-validation plan. After approval and before spawn,
 * a frozen systemRunPlan must still match what will execute — approval-time
 * checks alone are a time-of-check/time-of-use hole. Pure: null when
 * re-validation does not apply; else {ok:true, event} or the deny plan
 * (message, event, policyInput, guardNote). The revalidate check is injected.
 * @param {object} inp {name, plan, planFingerprint, isExec, bindEnabled, revalidate}
 */
export function planToctouRevalidation(inp) {
  if (!inp.plan || !inp.isExec || inp.bindEnabled === false) return null;
  const fingerprint = inp.planFingerprint || inp.plan?.fingerprint || null;
  const rv = inp.revalidate(inp.plan);
  if (rv.ok) {
    return {
      ok: true,
      event: {
        type: "security",
        phase: "plan_revalidated",
        name: inp.name,
        planFingerprint: fingerprint,
      },
    };
  }
  const message = rv.message || `Plan revalidation failed (${rv.reason || "drift"}).`;
  return {
    ok: false,
    message,
    event: {
      type: "security",
      phase: "plan_revalidate_failed",
      name: inp.name,
      reason: rv.reason,
      drift: rv.drift || null,
      planFingerprint: fingerprint,
      message,
    },
    policyInput: {
      phase: "plan_revalidate",
      decision: "deny",
      reason: rv.reason || "plan_drift",
      tool: inp.name,
    },
    guardNote: "DENIED: " + (rv.reason || "plan_drift"),
  };
}

/**
 * Stage 4d — approval-outcome plan. Given the gate's verdict, decide the
 * turn's next move: proceed (with the human-approved event when a human
 * answered), STOP on a pending ask (re-asking just retries the blocked
 * action — the approval-storm mechanism), or deny-and-continue with the
 * denial fed to the loop guard. The gate call itself stays in the loop;
 * formatBlockedReply is injected.
 * @param {object} auth  approvalGate.authorize result
 * @param {{name: string, args: object, formatBlockedReply: Function}} inp
 */
export function planApprovalOutcome(auth, inp) {
  if (auth.ok) {
    return {
      action: "proceed",
      event:
        auth.mode === "human"
          ? {
              type: "security",
              phase: "approved",
              name: inp.name,
              mode: auth.mode,
              note: auth.note,
              planFingerprint:
                auth.planFingerprint || auth.plan?.fingerprint || null,
            }
          : null,
    };
  }
  const isPending =
    auth.reason === "pending" ||
    auth.reason === "timeout" ||
    auth.pending === true ||
    Boolean(auth.pendingId);
  const pendingId = auth.pendingId || auth.id || null;
  const message = isPending
    ? inp.formatBlockedReply({
        tool: inp.name,
        reason: auth.reason || "awaiting approval",
        pendingId,
        argsPreview: JSON.stringify(inp.args || {}).slice(0, 180),
      })
    : auth.message || `Tool ${inp.name} blocked (${auth.reason || "denied"}).`;
  return {
    action: isPending ? "stop" : "deny",
    isPending,
    pendingId,
    message,
    pendingRecord: isPending
      ? { id: pendingId, tool: inp.name, args: inp.args, reason: auth.reason || "pending" }
      : null,
    event: {
      type: "security",
      phase: isPending ? "approval_required" : "denied",
      name: inp.name,
      reason: auth.reason,
      pendingId,
      // authorize already emitted approval_required via onPending when the
      // pending was created; this second emission after a timeout is a STATE
      // UPDATE, not a new ask — `restate` says so on the event itself so
      // consumers gate on isNewApprovalAsk() instead of deduping by hand.
      restate: true,
      timedOut: auth.reason === "timeout",
      message,
    },
    policyInput: {
      phase: "approval",
      decision: isPending ? "pending" : "deny",
      reason: auth.reason || (isPending ? "pending" : "denied"),
      tool: inp.name,
      pendingId,
      message,
    },
    guardNote: isPending ? null : `DENIED: ${message}`,
  };
}

export default {
  planApprovalOutcome,
  planToctouRevalidation,
  evaluateRunAllowlist,
  parseToolCallArgs,
  evaluateTurnPreflight,
  planPairingBackfill,
  computeStopReason,
  terminalStatus,
  planFinalAnswerRescue,
};
