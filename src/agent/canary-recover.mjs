/**
 * Soft-block canary: inject a verify turn when claims are ungrounded.
 */
import { runHallucinationCanary } from "./hallucination-canary.mjs";
import { incCanaryUngrounded } from "./canary-metrics.mjs";

export function softCanaryRecover({ text, toolTrace, messages } = {}) {
  const canary = runHallucinationCanary({ text, toolTrace });
  if (canary.ok) return { recovered: false, canary };
  incCanaryUngrounded(1);
  const prompt =
    "[canary] Your last reply claimed tool-backed results without matching tool evidence. " +
    "Verify with tools or revise claims. Ungrounded: " +
    (canary.ungrounded || []).slice(0, 3).join(" | ");
  if (Array.isArray(messages)) {
    messages.push({ role: "user", content: prompt });
  }
  return { recovered: true, canary, prompt };
}

export default { softCanaryRecover };
