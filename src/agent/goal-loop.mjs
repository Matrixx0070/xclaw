/**
 * A2 — Goal loop helpers: plan → act → verify → receipt.
 * Channel-invariant; used inside runAgentLoop / runAgent.
 */
import { buildToolHashChain } from "./tool-hash-chain.mjs";

export function buildGoalPlan(goal) {
  const objective = String(goal || "").trim() || "(empty goal)";
  const steps = [
    "Understand the goal and success criteria",
    "Gather context with tools (search, read, shell, browser as needed)",
    "Act to produce the result",
    "Verify with tools when accuracy matters",
    "Report outcome with evidence — not a checklist for the user",
  ];
  const g = objective.toLowerCase();
  const verifyHints = [];
  if (/\b(file|write|edit|create|save)\b/.test(g)) {
    verifyHints.push("After writing files, re-read or list to confirm");
  }
  if (/\b(tests?|build|ci|lint)\b/.test(g)) {
    verifyHints.push("Run the relevant test/build command and read the exit status");
  }
  if (/\b(http|url|api|endpoint|fetch|download)\b/.test(g)) {
    verifyHints.push("Confirm network results with a tool, not speculation");
  }
  if (/\b(search|find|docs|how to|what is)\b/.test(g)) {
    verifyHints.push("Use search/browse before concluding docs are unavailable");
  }
  if (verifyHints.length === 0) {
    verifyHints.push("Prefer tool evidence over unsupported claims");
  }
  return { objective, steps, verifyHints };
}

export function formatGoalPlanForPrompt(plan) {
  if (!plan?.objective) return "";
  const lines = [
    "",
    "## Goal loop (this run)",
    `Objective: ${plan.objective}`,
    "Phases:",
    ...plan.steps.map((s, i) => `  ${i + 1}. ${s}`),
    "Verify:",
    ...plan.verifyHints.map((h) => `  - ${h}`),
    "Stay on this goal until done or budget is exhausted. Prefer acting over asking.",
  ];
  return lines.join("\n");
}

export function listFailedTools(toolTrace = []) {
  const out = [];
  for (const t of toolTrace || []) {
    const st = t.status || (t.blocked ? "blocked" : "");
    if (st === "fail" || st === "error" || st === "timeout" || t.isError) {
      out.push({
        name: t.name || t.tool || "tool",
        reason: t.outcome?.summary || t.error?.message || st || "failed",
      });
    }
  }
  return out;
}

export function buildAlternateStrategyNudge(toolTrace) {
  const failed = listFailedTools(toolTrace);
  if (failed.length === 0) return null;
  const names = [...new Set(failed.map((f) => f.name))].slice(0, 5);
  return (
    `[goal-loop] Tool failure(s): ${names.join(", ")}. ` +
    `Do not repeat the exact same call. Switch strategy: different tool, different args, ` +
    `or a smaller sub-step. Continue the objective without handing the work back to the user.`
  );
}

export function buildGoalReceipt({
  goal,
  plan,
  toolTrace = [],
  finalText = "",
  stopReason = "natural",
  turns = 0,
  alternateStrategyUsed = false,
  handoffRetryUsed = false,
}) {
  const failed = listFailedTools(toolTrace);
  const toolsUsed = (toolTrace || []).map((t) => t.name || t.tool).filter(Boolean);
  const uniqueTools = [...new Set(toolsUsed)];
  const chain = buildToolHashChain(toolTrace || []);
  return {
    version: 1,
    goal: String(goal || "").slice(0, 500),
    toolHashTip: chain.tip,
    toolHashVersion: chain.version,
    objective: plan?.objective || String(goal || "").slice(0, 500),
    phases: plan?.steps || [],
    turns,
    stopReason,
    toolsUsed: uniqueTools,
    toolCallCount: toolTrace?.length || 0,
    failures: failed.slice(0, 10),
    alternateStrategyUsed: Boolean(alternateStrategyUsed),
    handoffRetryUsed: Boolean(handoffRetryUsed),
    preview: String(finalText || "").slice(0, 240),
  };
}

export default {
  buildGoalPlan,
  formatGoalPlanForPrompt,
  listFailedTools,
  buildAlternateStrategyNudge,
  buildGoalReceipt,
};
