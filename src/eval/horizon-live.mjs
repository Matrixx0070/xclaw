/**
 * Live horizon runner — API key optional.
 */
import { runHorizonSuiteOffline } from "./horizon-offline.mjs";

export function hasLiveKey(cfg = {}) {
  return Boolean(
    process.env.XCLAW_API_KEY ||
      process.env.XAI_API_KEY ||
      process.env.GROK_API_KEY ||
      cfg?.provider?.apiKey
  );
}

export async function runHorizonLive(opts = {}) {
  const requireLive = opts.requireLive === true || opts["require-live"] === true;
  const key = hasLiveKey(opts.cfg);
  if (!key) {
    if (requireLive) {
      return { ok: false, code: "LIVE_KEY_REQUIRED", offlineFallback: false };
    }
    return {
      ok: true,
      mode: "offline_fallback",
      ...(await runHorizonSuiteOffline(opts)),
    };
  }
  return {
    ok: true,
    mode: "live_pending",
    note: "Live provider loop not yet wired; use offline suite",
    hasKey: true,
    ...(await runHorizonSuiteOffline(opts)),
  };
}

export default { runHorizonLive, hasLiveKey };
