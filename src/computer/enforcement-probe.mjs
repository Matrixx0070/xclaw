/**
 * Grading primitives for the live enforcement probe.
 *
 * Split out of scripts/live-enforcement-e2e.mjs for the reason every inline
 * probe predicate ends up here: a decision written inside the script that
 * performs the I/O can only be exercised by performing the I/O, so it is
 * untestable by construction and was never tested. Two defects lived in it,
 * both found by running the probe against the real computer server on this
 * host while the suite stayed green.
 *
 * 1. It graded gates it could not prove were armed. The script sets
 *    XCLAW_COMMIT_GATES / XCLAW_FABRIC_ENFORCE / XCLAW_JSCODE_MODE on its OWN
 *    process and relies on startComputer spreading process.env into the child
 *    — but it only starts a child when no computer is already running, which
 *    on a live host never happens. Against the running server (none of those
 *    variables in its environ) both gates were simply off, the probe sailed
 *    through, and the report said "expected block, got success-like result":
 *    a broken gate named where no gate had ever been switched on. Hence
 *    `unmetPosture`, and hence the computer reporting its own posture rather
 *    than the script assuming it.
 *
 * 2. The commit-gate predicate had no arm for an upstream transport failure.
 *    The probe URL is https://shop.example/checkout, and .example is reserved,
 *    so the SSRF guard rejects it on DNS long before the navigate hook runs.
 *    The text
 *      [xclaw-ssrf] SSRF_BLOCKED: DNS resolution failed for shop.example:
 *      getaddrinfo ENOTFOUND shop.example
 *    matched neither the block pattern (xclaw-ssrf is not xclaw-hooks) nor the
 *    chrome arm (/not found/i wants a space; ENOTFOUND has none), so a request
 *    that never reached the gate was graded as the gate letting it through.
 *
 * Nothing here does I/O: the caller passes the tool's text and the posture the
 * server reported, and gets back a classification it can grade.
 */

/**
 * Failures that happened before the request could reach a gate. Checked ahead
 * of the browser arm because a net::ERR_ line routinely names chrome, and
 * grading one of those as "browser not set up" hides a reachability fault.
 */
const TRANSPORT_PATTERNS = [
  /SSRF_BLOCKED/i,
  /\bE(NOTFOUND|AI_AGAIN|CONNREFUSED|CONNRESET|TIMEDOUT|HOSTUNREACH|NETUNREACH)\b/,
  /net::ERR_/,
  /DNS resolution failed/i,
];

/** The browser itself is missing or would not start — a setup fault, not a verdict. */
const CHROME_PATTERNS = [/chrom(e|ium)/i];

/**
 * The gates this probe drives, each with the pattern that proves the gate
 * spoke and the posture requirement that has to hold for the gate to be able
 * to speak at all.
 */
export const GATES = {
  "live.commit_gate": {
    blocked: /COMMIT_GATE|xclaw-hooks|beforeNavigate|HOOKS_UNAVAILABLE/i,
    requires: "commitGate",
  },
  "live.jscode_block": {
    blocked: /JSCODE_MOTOR|JSCODE_DENIED|xclaw-hooks|beforeInput/i,
    requires: "jscode",
  },
};

/** Requirements unmetPosture knows how to decide. Anything else is not provable. */
export const REQUIREMENTS = new Set(["commitGate", "jscode"]);

/**
 * @param {{text?: string, isError?: boolean, gate?: {blocked: RegExp}}} input
 * @returns {"blocked"|"transport-error"|"chrome-unavailable"|"error"|"allowed"}
 */
export function classifyGateOutcome({ text = "", isError = false, gate = null } = {}) {
  const s = text == null ? "" : String(text);
  if (gate?.blocked && gate.blocked.test(s)) return "blocked";
  if (TRANSPORT_PATTERNS.some((re) => re.test(s))) return "transport-error";
  if (CHROME_PATTERNS.some((re) => re.test(s))) return "chrome-unavailable";
  // An error with no recognisable gate code does not prove a gate ran. The old
  // predicate counted a bare isError as a block, which is how any failure at
  // all could be reported as enforcement working.
  if (isError) return "error";
  return "allowed";
}

/**
 * Why the given gate cannot be proven on a computer with this posture, or null
 * when it can. The string is operator-facing: it must name the levers, because
 * "enforcement is off" without saying which switch is off is not actionable.
 *
 * @param {string} requirement
 * @param {object|null|undefined} posture as reported by the computer's /health
 * @returns {string|null}
 */
export function unmetPosture(requirement, posture) {
  if (!posture) {
    return "the computer reports no enforcement posture, so no gate result can be trusted";
  }
  if (requirement === "commitGate") {
    if (posture.enforcing) return null;
    return `enforcement is not armed in the computer process (${describePosture(posture)})`;
  }
  if (requirement === "jscode") {
    if (posture.jscodeMode === "allow") {
      return `jsCode policy is "allow" in the computer process, which returns before any motor pattern is examined (${describePosture(posture)})`;
    }
    // mode read/deny still needs something able to say no: either hooks.mjs
    // loads, or the bridge is enforcing and therefore fails closed without it.
    if (!posture.hooksModule && !posture.enforcing) {
      return `the hooks module is not resolvable and enforcement is off, so the bridge skips rather than blocks (${describePosture(posture)})`;
    }
    return null;
  }
  return `unknown posture requirement "${requirement}"`;
}

/** One-line rendering of a posture, or a plain statement that there is none. */
export function describePosture(posture) {
  if (!posture) return "posture unreported";
  return [
    `enforcing=${posture.enforcing === true}`,
    `commitGates=${posture.commitGates === true}`,
    `fabricEnforce=${posture.fabricEnforce === true}`,
    `hardenedProfile=${posture.hardenedProfile === true}`,
    `jscodeMode=${posture.jscodeMode ?? "?"}`,
    `hooksModule=${posture.hooksModule === true}`,
  ].join(" ");
}

export default { GATES, REQUIREMENTS, classifyGateOutcome, unmetPosture, describePosture };
