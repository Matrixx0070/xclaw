/**
 * Live autonomy / eval gate — skip when no usable API key.
 */

const KEY_ENVS = [
  "XAI_API_KEY",
  "XCLAW_API_KEY",
  "GROK_API_KEY",
  "OPENAI_API_KEY",
];

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function hasLiveApiKey(env = process.env) {
  for (const k of KEY_ENVS) {
    const v = env[k];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

/**
 * Exit with code 2 (intentional skip) when no key.
 * @param {object} [opts]
 * @returns {boolean} true if live allowed
 */
export function requireLiveApiKeyOrSkip(opts = {}) {
  const env = opts.env || process.env;
  if (hasLiveApiKey(env)) return true;
  const label = opts.label || "live-eval";
  console.error(
    `[${label}] SKIP: no API key (set XAI_API_KEY / XCLAW_API_KEY) — offline only`
  );
  if (opts.exit !== false) process.exit(opts.exitCode ?? 2);
  return false;
}

export function isLiveSkipExitCode(code) {
  return Number(code) === 2;
}

export default {
  hasLiveApiKey,
  requireLiveApiKeyOrSkip,
  isLiveSkipExitCode,
  KEY_ENVS,
};
