/**
 * Fast voice utterance router — casual vs agent vs command.
 * Keeps small-talk off the full tool loop for lower latency.
 */

import { classifyVoiceIntent } from "./commands.mjs";

const CASUAL_RE =
  /^(hi|hello|hey|thanks|thank you|ok|okay|bye|good (morning|night)|how are you|what('s| is) up)[\s!.?]*$/i;

const AGENT_HINT_RE =
  /\b(run|open|browse|search|file|write|read|bash|shell|install|git|commit|deploy|check|list|create|delete|swarm|job)\b/i;

/**
 * @param {string} text
 * @returns {{ mode: "command"|"casual"|"agent", intent?: object }}
 */
export function routeVoiceUtterance(text) {
  const intent = classifyVoiceIntent(text);
  if (intent.kind && intent.kind !== "utterance" && intent.kind !== "none") {
    return { mode: "command", intent };
  }
  const t = String(text || "").trim();
  if (!t) return { mode: "casual", intent: { kind: "none" } };
  if (CASUAL_RE.test(t) && !AGENT_HINT_RE.test(t)) {
    return { mode: "casual", intent: { kind: "utterance" } };
  }
  if (AGENT_HINT_RE.test(t) || t.length > 40) {
    return { mode: "agent", intent: { kind: "utterance" } };
  }
  // Short ambiguous → casual local reply unless clearly task-like
  if (t.split(/\s+/).length <= 4 && !AGENT_HINT_RE.test(t)) {
    return { mode: "casual", intent: { kind: "utterance" } };
  }
  return { mode: "agent", intent: { kind: "utterance" } };
}

/** Tiny local replies without LLM for pure greetings */
export function casualReply(text) {
  const t = String(text || "").toLowerCase();
  if (/thank/.test(t)) return "You're welcome.";
  if (/bye|good night/.test(t)) return "Goodbye.";
  if (/how are you/.test(t)) return "Ready when you are.";
  if (/hi|hello|hey|what's up|good morning/.test(t)) return "Hey — I'm listening.";
  if (/^ok/.test(t)) return "Okay.";
  return "Got it.";
}

export default { routeVoiceUtterance, casualReply };
