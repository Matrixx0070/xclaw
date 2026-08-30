/**
 * Minimal one-shot agent entry for automations / CLI helpers.
 * A0: delegates to channel-invariant runAgent.
 *
 * Automations own their own segmentation (scheduled ticks; goal-mode
 * "single most useful next step"). Undefined continuation would ON the
 * inner loop (maxTurns * 4) inside one tick. Persist stays in the
 * automations store — do not mint agent-run snapshots here.
 */
import { runAgent } from "./run-agent.mjs";

export async function runAgentOnce({ cfg, message, goal, channel = "automation" } = {}) {
  const text = String(message || goal || "").trim();
  if (!text) return { ok: false, error: "empty_message" };
  try {
    const out = await runAgent({
      goal: text,
      cfg: cfg || {},
      channel,
      continuation: false, // automations own the tick — single-segment run
    });
    return {
      ok: out.ok,
      text: out.text || "",
      error: out.error,
      raw: out.raw,
    };
  } catch (e) {
    // soft fail for automation results store
    return { ok: false, error: e.message || String(e) };
  }
}
