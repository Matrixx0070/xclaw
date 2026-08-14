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
 *   router.rolePolicy.verifyReplace — if true, replace finalText with VERIFY_REVISE body
 *   router.rolePolicy.verifyAppend  — if true (and not replace), append VERIFY section to finalText
 *   default: event-only soft critique (verify_suggest) unless replace/append set
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

  const text = extractCompletionText(completion);
  const trimmed = String(text).trim();
  // SCAFFOLD: prose sentinel protocol (VERIFY_OK/VERIFY_REVISE prefixes) —
  // migrate to a structured tool-call verdict like the critic merge-gate did.
  const ok = /^VERIFY_OK\b/i.test(trimmed);
  const revise = /^VERIFY_REVISE\b/i.test(trimmed);

  let revisedText = null;
  if (revise) {
    revisedText = trimmed.replace(/^VERIFY_REVISE\s*/i, "").trim();
  } else if (!ok && trimmed) {
    // Model ignored protocol — treat full reply as soft critique, not silent OK
    revisedText = trimmed;
  }

  const replace = policy.verifyReplace === true;
  const append = policy.verifyAppend === true;
  let nextFinal = finalText;
  let replaced = false;
  let appended = false;
  if (revise && revisedText && replace) {
    nextFinal = revisedText;
    replaced = true;
  } else if ((revise || (!ok && revisedText)) && revisedText && append) {
    nextFinal = `${String(finalText).trim()}\n\n---\nVERIFY:\n${revisedText}`;
    appended = true;
  }

  const out = {
    skipped: false,
    ok,
    revise: Boolean(revise || (!ok && revisedText)),
    raw: trimmed,
    revisedText,
    finalText: nextFinal,
    replaced,
    appended,
  };

  onEvent({
    type: "router",
    phase: "verify_done",
    ok,
    revise: out.revise,
    replaced,
    appended,
    preview: trimmed.slice(0, 400),
  });

  return out;
}

/** Normalize provider completion content (string or multipart). */
export function extractCompletionText(completion) {
  const raw =
    completion?.message?.content ??
    completion?.content ??
    completion?.text ??
    "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((p) => {
        if (typeof p === "string") return p;
        if (p?.type === "text" && p.text) return p.text;
        if (p?.text) return p.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(raw || "");
}

export { DEFAULT_VERIFY_INSTRUCTION };
export default { runVerifyPass };
