/**
 * Minimal one-shot agent entry for automations / CLI.
 */
export async function runAgentOnce({ cfg, message, goal } = {}) {
  const text = String(message || goal || "").trim();
  if (!text) return { ok: false, error: "empty_message" };
  try {
    const { runAgentLoop } = await import("./loop.mjs");
    // runAgentLoop takes `userMessage` (string) — passing a `messages` array
    // here silently produced content:undefined requests (Provider HTTP 400).
    const out = await runAgentLoop({
      cfg: cfg || {},
      userMessage: text,
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
