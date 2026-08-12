/**
 * Turn goal / progress state — structured belief about the current agent turn.
 * Used for suggestions, UX copy, metrics, and blocked/approval handling.
 */

/**
 * @typedef {"idle"|"planning"|"acting"|"blocked"|"failed"|"done"|"aborted"} TurnPhase
 */

/**
 * Infer a coarse goal type from the user message.
 * SCAFFOLD: regex intent classification — a capable model states its own goal;
 * replace with model-declared turn metadata when the loop requests it.
 * @param {string} userMessage
 */
export function inferGoal(userMessage) {
  const u = String(userMessage || "").trim();
  if (!u) {
    return { type: "unknown", text: "", action: false, question: false };
  }
  const question =
    /\?$/.test(u) ||
    /^(what|why|how|when|where|who|explain|describe|list)\b/i.test(u);
  const action =
    /^(add|implement|fix|write|create|update|refactor|ship|run|test|wire|build|deploy|commit|install|remove|delete|rename)\b/i.test(
      u
    ) ||
    /\b(implement|add|fix|wire|create)\b/i.test(u);

  let type = "general";
  if (action && /\b(test|spec)\b/i.test(u)) type = "test";
  else if (action && /\b(fix|bug|error)\b/i.test(u)) type = "fix";
  else if (action && /\b(commit|push|pr)\b/i.test(u)) type = "ship";
  else if (action) type = "implement";
  else if (question) type = "question";
  else if (/\b(search|find|look up|research)\b/i.test(u)) type = "research";

  return {
    type,
    text: u.slice(0, 500),
    action,
    question,
  };
}

/**
 * Build progress snapshot from toolTrace + flags.
 * @param {object} opts
 */
export function buildTurnProgress(opts = {}) {
  const toolTrace = opts.toolTrace || [];
  const pendingApproval = opts.pendingApproval || null;
  const maxTurns = opts.maxTurns ?? 15;
  const turns = opts.turns ?? 0;
  const finalText = String(opts.finalText || "");
  const aborted = Boolean(opts.aborted);
  const loopGuardStop = Boolean(opts.loopGuardStop);

  const counts = {
    ok: 0,
    fail: 0,
    error: 0,
    blocked: 0,
    timeout: 0,
    other: 0,
  };
  const blockers = [];
  const artifacts = [];
  const openQuestions = [];

  for (const e of toolTrace) {
    const st = e.status || (e.blocked ? "blocked" : "other");
    if (counts[st] != null) counts[st] += 1;
    else counts.other += 1;

    if (st === "blocked" || st === "denied") {
      blockers.push({
        type: "policy",
        tool: e.name,
        reason: e.policy?.reason || e.outcome?.summary || "blocked",
        pendingId: e.policy?.pendingId,
      });
    }
    if (st === "fail" || st === "error" || st === "timeout") {
      blockers.push({
        type: "tool_fail",
        tool: e.name,
        reason: e.outcome?.summary || e.error?.message || st,
        kind: e.outcome?.kind,
      });
    }
    for (const a of e.artifacts || []) {
      if (a?.ref) artifacts.push({ ...a, tool: e.name });
    }
  }

  if (pendingApproval) {
    blockers.push({
      type: "approval",
      tool: pendingApproval.tool || pendingApproval.name,
      reason: "awaiting human approval",
      pendingId: pendingApproval.id || pendingApproval.pendingId,
    });
  }

  /** @type {TurnPhase} */
  let phase = "idle";
  if (aborted) phase = "aborted";
  else if (pendingApproval || counts.blocked > 0) phase = "blocked";
  else if (counts.fail + counts.error + counts.timeout > 0) phase = "failed";
  else if (loopGuardStop) phase = "failed";
  else if (
    toolTrace.length > 0 &&
    counts.fail + counts.error + counts.blocked + counts.timeout === 0 &&
    (/\b(done|fixed|complete|implemented|all tests pass)\b/i.test(finalText) ||
      turns > 0)
  ) {
    // provisional done — refined by caller with closure
    phase = "acting";
  } else if (toolTrace.length > 0) phase = "acting";
  else if (finalText) phase = "planning";

  const progress = {
    phase,
    turns,
    maxTurns,
    toolsRun: toolTrace.length,
    counts,
    blockers,
    artifacts: artifacts.slice(0, 20),
    openQuestions,
    pendingApproval: pendingApproval
      ? {
          id: pendingApproval.id || pendingApproval.pendingId,
          tool: pendingApproval.tool || pendingApproval.name,
        }
      : null,
    hitMaxTurns: turns >= maxTurns && !finalText,
  };

  return progress;
}

/**
 * Apply closure detection onto progress phase.
 * @param {object} progress
 * @param {{ closed: boolean, confidence: number, reason: string }} closure
 */
export function applyClosureToProgress(progress, closure) {
  if (!progress) return progress;
  const p = { ...progress, closure: closure || null };
  if (progress.phase === "blocked" || progress.phase === "aborted") return p;
  if (closure?.closed && (closure.confidence || 0) >= 0.6) {
    p.phase = "done";
  } else if (
    progress.counts.fail + progress.counts.error + progress.counts.timeout > 0
  ) {
    p.phase = "failed";
  } else if (progress.toolsRun > 0) {
    p.phase = progress.blockers.length ? "blocked" : "acting";
  }
  return p;
}

/**
 * User-facing message when tools are blocked on approval.
 */
export function formatBlockedReply(opts = {}) {
  const { tool, reason, pendingId, argsPreview } = opts;
  const lines = [
    "🔐 **Approval required**",
    tool ? `Tool: \`${tool}\`` : null,
    reason ? `Reason: ${reason}` : null,
    pendingId ? `Id: \`${pendingId}\`` : null,
    argsPreview ? `Args: \`${String(argsPreview).slice(0, 200)}\`` : null,
    "",
    "Approve from Telegram inline buttons, CLI, or the gateway approvals API, then ask me to continue.",
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * Compose full turn state object returned from the agent loop.
 */
export function buildTurnState(opts = {}) {
  const goal = opts.goal || inferGoal(opts.userMessage);
  let progress = buildTurnProgress(opts);
  if (opts.closure) {
    progress = applyClosureToProgress(progress, opts.closure);
  }
  return {
    goal,
    progress,
    phase: progress.phase,
    summary: summarizeTurnState(goal, progress),
  };
}

/**
 * One-line summary for logs / doctor.
 */
export function summarizeTurnState(goal, progress) {
  const g = goal?.type || "general";
  const phase = progress?.phase || "idle";
  const tools = progress?.toolsRun || 0;
  const b = progress?.blockers?.length || 0;
  return `goal=${g} phase=${phase} tools=${tools} blockers=${b}`;
}

/**
 * Whether suggestions should treat this as pending approval.
 */
export function isTurnBlocked(turnState) {
  return (
    turnState?.phase === "blocked" ||
    Boolean(turnState?.progress?.pendingApproval) ||
    (turnState?.progress?.blockers || []).some((b) => b.type === "approval")
  );
}

export default {
  inferGoal,
  buildTurnProgress,
  applyClosureToProgress,
  formatBlockedReply,
  buildTurnState,
  summarizeTurnState,
  isTurnBlocked,
};
