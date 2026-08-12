/**
 * Environment policy for tool spawns (bash/exec).
 *
 * Secrets must not be ambient in tool subprocesses: an agent-authored command
 * should not inherit API keys / tokens unless the operator opts in.
 *
 * Config:
 *   security.bashEnv: "strip-secrets" | "allowlist" | "inherit"
 *     strip-secrets (default) — inherit env minus secret-looking names
 *     allowlist (prod)        — only a base allowlist + security.envAllow
 *     inherit                 — legacy full process.env
 *   security.envAllow: string[]  names always kept (both modes)
 *   security.envDeny:  string[]  names always stripped (both modes)
 * Env override:
 *   XCLAW_BASH_ENV=strip-secrets|allowlist|inherit
 */

/** Names that look like credentials — stripped in strip-secrets mode. */
const SECRET_NAME_RE =
  /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_KEY|ACCESS_KEY|SESSION_?(ID|KEY)|COOKIE|_AUTH|AUTH_|WEBHOOK)/i;

/** Baseline vars a usable non-login shell needs (allowlist mode). */
const BASE_ALLOW = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "PWD",
  "COLUMNS",
  "LINES",
  "NODE_ENV",
  "CI",
]);

const ALLOW_PREFIXES = ["LC_"];

/**
 * @param {object} [cfg]
 * @returns {"strip-secrets"|"allowlist"|"inherit"}
 */
export function getEnvPolicyMode(cfg = {}) {
  const env = String(process.env.XCLAW_BASH_ENV || "").toLowerCase();
  if (env === "inherit" || env === "allowlist" || env === "strip-secrets") return env;
  const m = String(cfg?.security?.bashEnv || "").toLowerCase();
  if (m === "inherit" || m === "allowlist" || m === "strip-secrets") return m;
  return "strip-secrets";
}

/**
 * Build the env object a tool subprocess may see.
 * @param {object} [cfg]
 * @param {object} [sourceEnv] defaults to process.env
 * @returns {{ env: object, mode: string, stripped: string[] }}
 */
export function buildToolEnv(cfg = {}, sourceEnv = process.env) {
  const mode = getEnvPolicyMode(cfg);
  const allowExtra = new Set(
    (cfg?.security?.envAllow || []).map((s) => String(s))
  );
  const denyExtra = new Set((cfg?.security?.envDeny || []).map((s) => String(s)));

  /** @type {object} */
  const out = {};
  /** @type {string[]} */
  const stripped = [];

  for (const [k, v] of Object.entries(sourceEnv)) {
    if (v == null) continue;
    if (denyExtra.has(k)) {
      stripped.push(k);
      continue;
    }
    if (allowExtra.has(k)) {
      out[k] = v;
      continue;
    }
    if (mode === "inherit") {
      out[k] = v;
      continue;
    }
    if (mode === "allowlist") {
      if (BASE_ALLOW.has(k) || ALLOW_PREFIXES.some((p) => k.startsWith(p))) {
        out[k] = v;
      } else {
        stripped.push(k);
      }
      continue;
    }
    // strip-secrets
    if (SECRET_NAME_RE.test(k)) {
      stripped.push(k);
    } else {
      out[k] = v;
    }
  }

  return { env: out, mode, stripped };
}

export default { getEnvPolicyMode, buildToolEnv };
