/**
 * A7 — jsCode policy under fabric/prod
 *
 * When XCLAW_FABRIC_ENFORCE or strict prod:
 *   - jsCode that looks like click/type/submit is denied
 *   - use motor (browser_click / browser_type) instead
 *
 * XCLAW_JSCODE_MODE=read|deny|allow
 *   read  = block motor-like patterns (default under enforce)
 *   deny  = block all jsCode under enforce
 *   allow = never block (lab)
 */

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
    process.env.XCLAW_PROFILE === "prod";
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
