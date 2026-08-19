/**
 * Resolve G10–G14 (default) case prompts so live runAgent never gets empty_goal.
 */
import { loadCases } from "./runner.mjs";
import { DEFAULT_LIVE_IDS } from "./horizon-live-report.mjs";

export async function resolveLiveGoals(opts = {}) {
  const ids =
    Array.isArray(opts.ids) && opts.ids.length ? opts.ids : DEFAULT_LIVE_IDS;
  const goals = [];
  for (const id of ids) {
    const cases = await loadCases({ id });
    const caseDef = cases[0] || null;
    const prompt = String(
      opts.goals?.[id] || caseDef?.prompt || caseDef?.goal || ""
    ).trim();
    goals.push({
      id,
      prompt,
      maxTurns: caseDef?.maxTurns,
      timeoutMs: caseDef?.timeoutMs,
      ok: Boolean(prompt),
      reason: prompt ? null : "missing_prompt",
    });
  }
  return { ids, goals };
}

export default { resolveLiveGoals, DEFAULT_LIVE_IDS };
