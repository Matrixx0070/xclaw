/**
 * Minimal one-shot agent entry for automations / CLI.
 */
export async function runAgentOnce({ cfg, message, goal } = {}) {
  const text = String(message || goal || "").trim();
  if (!text) return { ok: false, error: "empty_message" };
  try {
    const { runAgentLoop } = await import("./loop.mjs");
    const out = await runAgentLoop({
      cfg: cfg || {},
      messages: [{ role: "user", content: text }],
      goal: text,
    });
    return {
      ok: true,
      text: out?.finalText || out?.text || out?.reply || JSON.stringify(out).slice(0, 1500),
      raw: out,
    };
  } catch (e) {
    // loop signature may differ — soft fail for automation results store
    return { ok: false, error: e.message || String(e) };
  }
}
