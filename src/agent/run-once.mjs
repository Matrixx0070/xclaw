/**
 * Minimal one-shot agent entry for automations / CLI helpers.
 * A0: delegates to channel-invariant runAgent.
 */
import { runAgent } from "./run-agent.mjs";

export async function runAgentOnce({ cfg, message, goal, channel = "automation" } = {}) {
  const text = String(message || goal || "").trim();
  if (!text) return { ok: false, error: "empty_message" };
  const out = await runAgent({
    goal: text,
    cfg: cfg || {},
    channel,
  });
  return {
    ok: out.ok,
    text: out.text || "",
    error: out.error,
    raw: out.raw,
  };
}
