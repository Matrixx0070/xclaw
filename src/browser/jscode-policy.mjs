/**
 * A7 — jsCode policy under fabric/prod
 *
 * When XCLAW_FABRIC_ENFORCE, XCLAW_ENFORCEMENT_STRICT, or a hardened
 * profile (prod / its alias strict, from the config file or the environment):
 *   - jsCode that looks like click/type/submit is denied
 *   - use motor (browser_click / browser_type) instead
 *
 * XCLAW_JSCODE_MODE=read|deny|allow
 *   read  = block motor-like patterns (default under enforce)
 *   deny  = block all jsCode under enforce
 *   allow = never block (lab)
 */
import { isHardenedProfile } from "../config/profiles.mjs";

const MOTOR_PATTERNS = [
  /\.click\s*\(/i,
  /\.submit\s*\(/i,
  /dispatchEvent\s*\(/i,
  /MouseEvent/i,
  /KeyboardEvent/i,
  /execCommand\s*\(\s*['"]insertText/i,
  /\.value\s*=/i,
  /document\.write/i,
  /form\.submit/i,
  /\.focus\s*\(\s*\)\s*;[\s\S]{0,80}\.click/i,
];

export function jscodeMode() {
  const m = String(process.env.XCLAW_JSCODE_MODE || "").toLowerCase();
  if (m === "allow" || m === "deny" || m === "read") return m;
  const enforce =
    process.env.XCLAW_FABRIC_ENFORCE === "1" ||
    process.env.XCLAW_FABRIC_ENFORCE === "true" ||
    process.env.XCLAW_ENFORCEMENT_STRICT === "1" ||
    // Ask the owning predicate, not the raw variable. A bare
    // `process.env.XCLAW_PROFILE === "prod"` missed every spelling the loader
    // canonicalises — a config file saying prod (nothing assigns that env var),
    // the alias `strict`, any casing — and this gate fails OPEN, so each miss
    // turned the whole motor-pattern policy off on a host every other gate
    // treated as hardened.
    isHardenedProfile();
  return enforce ? "read" : "allow";
}

export function looksLikeMotorJs(jsCode) {
  const s = String(jsCode || "");
  if (!s.trim()) return false;
  return MOTOR_PATTERNS.some((re) => re.test(s));
}

/**
 * @returns {{ ok: boolean, code?: string, reason?: string, mode?: string }}
 */
export function assertJsCodeAllowed(jsCode, opts = {}) {
  const mode = opts.mode || jscodeMode();
  if (mode === "allow") return { ok: true, mode };
  if (!jsCode || !String(jsCode).trim()) return { ok: true, mode };

  if (mode === "deny") {
    return {
      ok: false,
      code: "JSCODE_DENIED",
      reason: "jsCode disabled under enforcement — use browser_observe/snapshot or motor tools",
      mode,
    };
  }

  // read mode
  if (looksLikeMotorJs(jsCode)) {
    return {
      ok: false,
      code: "JSCODE_MOTOR_PATTERN",
      reason:
        "jsCode looks like click/type/submit — use browser_click / browser_type (CDP motor) under enforcement",
      mode,
    };
  }
  return { ok: true, mode };
}

export default { jscodeMode, looksLikeMotorJs, assertJsCodeAllowed };

/**
 * Grade the live A7 posture for a reporter.
 *
 * The doctor used to grade `mode === "allow"` as `ok` with the text
 * "jsCode allow (lab)" — an affirmative pass that ASSERTS the host is a lab,
 * on the one host where that claim matters most. It printed exactly that on a
 * prod host while the policy was off. Whether "allow" is healthy depends on
 * whether the host is hardened, so the grade has to ask.
 *
 * Pure so it can be tested: the doctor's own probe calls loadConfig itself and
 * cannot be driven from a test.
 *
 * @param {{ mode: string, hardened: boolean, blocked: { ok: boolean, code?: string } }} state
 * @returns {{ severity: "ok"|"warn", detail: string }}
 */
export function gradeJsCodePolicy({ mode, hardened, blocked }) {
  if (mode === "allow") {
    return hardened
      ? {
          severity: "warn",
          detail:
            "jsCode unrestricted on a hardened host — motor patterns not blocked (XCLAW_JSCODE_MODE=allow overrides the profile)",
        }
      : { severity: "ok", detail: "jsCode allow (lab) — motor patterns not blocked" };
  }
  if (blocked && blocked.ok === false) {
    return { severity: "ok", detail: `motor-like jsCode blocked (${blocked.code})` };
  }
  return { severity: "warn", detail: `expected motor jsCode to be blocked under mode=${mode}` };
}
