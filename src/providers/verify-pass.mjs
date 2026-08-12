/**
 * Final-answer verify pass — strong model critiques / refines act output.
 *
 * Runs when:
 *   - router.roles.verify (or strong) is configured
 *   - rolePolicy.lastTurnVerify !== false
 *   - agent produced final text with no tool calls
 *
 * Config:
 *   router.rolePolicy.verifyPrompt — custom system instruction
 *   router.rolePolicy.verifyMaxTokens — optional
 *   router.rolePolicy.verifyReplace — if true, replace finalText with verify output
 *                                    if false (default), append critique section only when issues found
 */

const DEFAULT_VERIFY_INSTRUCTION = `You are the VERIFY role for XClaw. Review the assistant's final answer for the user's goal.

Check:
1. Correctness and completeness vs the user request
2. Hallucinated paths, commands, or APIs
3. Missing edge cases or unsafe suggestions
4. Whether the answer is actionable

If the answer is good enough, reply with exactly:
VERIFY_OK
Then a one-line summary.

If it needs fixes, reply with:
VERIFY_REVISE
Then the improved full answer (not only a diff).`;

/**
 * @param {object} opts
 * @param {object} opts.provider - role-aware provider with .verify or chat({role:'verify'})
 * @param {string} opts.userMessage
 * @param {string} opts.finalText
 * @param {object} opts.cfg
 * @param {Array} [opts.messages] - optional prior context (truncated)
 * @param {(e: object) => void} [opts.onEvent]
 */
export async function runVerifyPass(opts = {}) {
  const {
    provider,
    userMessage,
    finalText,
    cfg = {},
    onEvent = () => {},
  } = opts;

  const policy = cfg.router?.rolePolicy || {};
  if (policy.lastTurnVerify === false) {
    return { skipped: true, reason: "disabled" };
  }
  if (!finalText || !String(finalText).trim()) {
    return { skipped: true, reason: "empty_final" };
  }
  if (!provider) {
    return { skipped: true, reason: "no_provider" };
  }

  const hasVerify =
    typeof provider.verify === "function" ||
    (provider.roles && (provider.roles.verify || provider.roles.strong));
  if (!hasVerify && typeof provider.chat !== "function") {
    return { skipped: true, reason: "no_verify_role" };
  }

  const instruction =
    policy.verifyPrompt ||
    cfg.router?.verifyPrompt ||
    DEFAULT_VERIFY_INSTRUCTION;

  const verifyMessages = [
    { role: "system", content: instruction },
    {
      role: "user",
      content: `## User request\n${String(userMessage).slice(0, 8000)}\n\n## Assistant final answer\n${String(finalText).slice(0, 20000)}`,
    },
  ];

  onEvent({
    type: "router",
    phase: "verify_start",
    modelRef: provider.roles?.verify || provider.modelRef,
  });

  let completion;
  try {
    if (typeof provider.verify === "function") {
      completion = await provider.verify({
        messages: verifyMessages,
        tools: undefined,
      });
    } else {
      completion = await provider.chat({
        messages: verifyMessages,
        role: "verify",
      });
    }
  } catch (err) {
    onEvent({
      type: "router",
      phase: "verify_error",
      message: String(err.message || err),
    });
    return { skipped: true, reason: "error", error: String(err.message || err) };
  }

  const text = completion?.message?.content || completion?.content || "";
  const trimmed = String(text).trim();
  // SCAFFOLD: prose sentinel protocol (VERIFY_OK/VERIFY_REVISE prefixes) —
  // migrate to a structured tool-call verdict like the critic merge-gate did.
  const ok = /^VERIFY_OK\b/i.test(trimmed);
  const revise = /^VERIFY_REVISE\b/i.test(trimmed);

  let revisedText = null;
  if (revise) {
    revisedText = trimmed.replace(/^VERIFY_REVISE\s*/i, "").trim();
  }

  const replace = policy.verifyReplace === true;
  const out = {
    skipped: false,
    ok,
    revise,
    raw: trimmed,
    revisedText,
    finalText: replace && revisedText ? revisedText : finalText,
    replaced: Boolean(replace && revisedText),
  };

  onEvent({
    type: "router",
    phase: "verify_done",
    ok,
    revise,
    replaced: out.replaced,
    preview: trimmed.slice(0, 400),
  });

  return out;
}

export { DEFAULT_VERIFY_INSTRUCTION };
export default { runVerifyPass };
