/**
 * A1 — Agent autonomy policy (channel-invariant).
 *
 * Goal-agnostic: tool-first progress, low handoff, verify when possible.
 * Applied in runAgentLoop for every surface (CLI / Telegram / Web / …).
 */

/** @typedef {{ toolFirst: boolean, maxHandoffs: number, requireVerifyHint: boolean, handoffRetry: boolean }} AutonomyPolicy */

/**
 * @param {object} [cfg]
 * @returns {AutonomyPolicy}
 */
export function resolveAutonomyPolicy(cfg = {}) {
  const p = cfg.autonomy?.agent || cfg.agent?.autonomy || {};
  return {
    toolFirst: p.toolFirst !== false,
    maxHandoffs: Number.isFinite(p.maxHandoffs) ? Number(p.maxHandoffs) : 1,
    requireVerifyHint: p.requireVerifyHint !== false,
    handoffRetry: p.handoffRetry !== false,
  };
}

/**
 * System-prompt appendix — same for all channels.
 * @param {AutonomyPolicy} policy
 */
export function buildAutonomyAppendix(policy) {
  if (!policy?.toolFirst && !policy?.requireVerifyHint) return "";
  const lines = [
    "",
    "## Autonomy (required)",
    "You are a goal-driven agent, not a chatbot that delegates work back to the user.",
  ];
  if (policy.toolFirst) {
    lines.push(
      "- Tool-first: for research, docs, files, shell, network, or environment questions — use tools before asking the user.",
      "- Prefer search/browse/read/run over questions like \"paste the endpoint\" or \"tell me how\".",
      "- If a tool fails, try a different tool or query once. Only then ask the user for a missing secret or irreversible consent.",
      "- Do not stop at \"I can't\" when a tool might work. Attempt the action."
    );
  }
  if (policy.requireVerifyHint) {
    lines.push(
      "- Verify when accuracy matters: after writes or external claims, re-check with a tool when feasible.",
      "- Final answer should reflect tool evidence; mark uncertainty explicitly."
    );
  }
  lines.push(
    `- Handoff budget: at most ${policy.maxHandoffs} request(s) for user-provided secrets or confirmations per goal.`,
    "- Close the loop: act → observe → answer. Prefer a completed result over a checklist for the user."
  );
  return lines.join("\n");
}

/** Patterns that usually mean the model is handing work back to the human. */
const HANDOFF_RE =
  /\b(please\s+(paste|provide|send|share|upload)|could you\s+(paste|provide|send)|you\s+(need to|should|must|have to)\s+(paste|log\s*in|open|navigate|screenshot|manually)|give me\s+(the\s+)?(endpoint|url|credentials|password|username|api\s*key|token)|i (can't|cannot) (access|see|do)|without (you|your)\s+)/i;

/**
 * @param {string} text
 */
export function looksLikeHandoff(text) {
  const s = String(text || "").trim();
  if (s.length < 20) return false;
  return HANDOFF_RE.test(s);
}

/**
 * Count tool results in a loop toolTrace.
 * @param {object[]} [toolTrace]
 */
export function countToolsUsed(toolTrace) {
  if (!Array.isArray(toolTrace)) return 0;
  return toolTrace.filter((t) => t && (t.name || t.tool || t.phase === "end")).length;
}

/**
 * Zero tools + handoff-style final text → one forced retry is warranted.
 * @param {{ policy: AutonomyPolicy, toolTrace?: object[], finalText?: string }} args
 */
export function shouldForceToolRetry({ policy, toolTrace, finalText }) {
  if (!policy?.toolFirst || !policy?.handoffRetry) return false;
  if (countToolsUsed(toolTrace) > 0) return false;
  return looksLikeHandoff(finalText);
}

export const HANDOFF_RETRY_USER_PROMPT =
  "[autonomy] You handed work back to the user without using tools. " +
  "Continue the same goal now: use available tools (search, browse, shell, files, browser) to make real progress. " +
  "Do not ask the user to perform steps you can attempt. " +
  "Ask the user only if a secret or irreversible approval is strictly required after tools were tried.";

export default {
  resolveAutonomyPolicy,
  buildAutonomyAppendix,
  looksLikeHandoff,
  countToolsUsed,
  shouldForceToolRetry,
  HANDOFF_RETRY_USER_PROMPT,
};
