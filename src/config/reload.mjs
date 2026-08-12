/**
 * Soft reload: re-read config file and apply safe keys in-place.
 * Does not rebind ports or restart computer.
 */
import { loadConfig } from "./load.mjs";

const SAFE_KEYS = [
  "profile",
  "agent",
  "security",
  "retry",
  "queue",
  "eval",
  "readiness",
  "shutdown",
  "tokens",
];

/**
 * Mutate live cfg object with freshly loaded safe fields.
 * @param {object} liveCfg
 * @returns {Promise<{ ok: boolean, changed: string[] }>}
 */
export async function softReloadConfig(liveCfg) {
  const next = await loadConfig();
  const changed = [];
  for (const k of SAFE_KEYS) {
    if (next[k] !== undefined) {
      const before = JSON.stringify(liveCfg[k]);
      liveCfg[k] = next[k];
      if (JSON.stringify(liveCfg[k]) !== before) changed.push(k);
    }
  }
  // paths stay from original process
  return { ok: true, changed, profile: liveCfg.profile };
}
