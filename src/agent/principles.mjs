/**
 * Autonomous agent principles for long-running XClaw harness.
 *
 * Philosophy (operator):
 * - Long-lived subordinate, not a product demo
 * - Survive interruption; recoverable via checkpoints
 * - Privacy/sovereignty: nothing critical leaves unless allowed
 * - Autonomy is earned (levels) and fail-closed on security/money/grounding
 * - Fully inspectable and killable
 *
 * Runtime: principles become system notes + harness defaults + doctor posture.
 */

export const PRINCIPLES_VERSION = 1;

/** Short axioms always injected in harness / full autonomy long runs */
export const AUTONOMOUS_PRINCIPLES = `
## Autonomous agent principles (XClaw)

1. Goal-first: pursue the stated goal until verify succeeds or budget/safety stops you.
2. Grounding: never invent file contents, paths, command output, or tool results.
3. Verify-by-tool: after writes, re-read or run checks; prefer objective evidence.
4. Minimal force: smallest tool sequence that achieves the goal; no busy loops.
5. Recoverable: assume crash mid-run — leave the workspace coherent for resume.
6. Fail closed: if blocked by approval, policy, or budget, report clearly — do not fake success.
7. Structured claims: end long work with JSON claims + evidence_ids matching real tools.
8. Killable: respect abort signals; no hidden background side effects outside tools.
`.trim();

/**
 * Map autonomy level → principle enforcement defaults.
 * @param {"off"|"supervised"|"lab"|"full"} level
 */
export function principlesForLevel(level) {
  const base = {
    version: PRINCIPLES_VERSION,
    systemNotes: [AUTONOMOUS_PRINCIPLES],
    groundHard: false,
    claimsRequireEvidence: false,
    requireStructuredClaims: false,
    checkpointEveryTurns: 0,
    groundingRetry: 0,
  };
  switch (level) {
    case "off":
      return {
        ...base,
        systemNotes: [
          AUTONOMOUS_PRINCIPLES,
          "Autonomy level OFF: wait for explicit human direction; do not expand scope.",
        ],
      };
    case "supervised":
      return {
        ...base,
        groundHard: true,
        claimsRequireEvidence: true,
        requireStructuredClaims: true,
        checkpointEveryTurns: 3,
        groundingRetry: 1,
        systemNotes: [
          AUTONOMOUS_PRINCIPLES,
          "Autonomy SUPERVISED: risky tools need approval. Ground all claims. Checkpoint progress.",
        ],
      };
    case "lab":
      return {
        ...base,
        groundHard: true,
        claimsRequireEvidence: true,
        requireStructuredClaims: true,
        checkpointEveryTurns: 3,
        groundingRetry: 1,
        systemNotes: [
          AUTONOMOUS_PRINCIPLES,
          "Autonomy LAB: trusted tools, still fail-closed on ungrounded claims.",
        ],
      };
    case "full":
      return {
        ...base,
        groundHard: true,
        claimsRequireEvidence: true,
        requireStructuredClaims: true,
        checkpointEveryTurns: 2,
        groundingRetry: 1,
        systemNotes: [
          AUTONOMOUS_PRINCIPLES,
          "Autonomy FULL: long-horizon allowed; heartbeat may run; still no hallucinated success.",
        ],
      };
    default:
      return base;
  }
}

/**
 * Merge principle defaults into harness/job opts (opts win).
 */
export function applyPrinciplesToHarnessOpts(opts = {}, level = "lab") {
  const p = principlesForLevel(level);
  return {
    ...opts,
    groundHard: opts.groundHard ?? p.groundHard,
    claimsRequireEvidence: opts.claimsRequireEvidence ?? p.claimsRequireEvidence,
    requireStructuredClaims:
      opts.requireStructuredClaims ?? p.requireStructuredClaims,
    checkpointEveryTurns: opts.checkpointEveryTurns ?? p.checkpointEveryTurns,
    groundingRetry: opts.groundingRetry ?? p.groundingRetry,
    systemNotes: [
      ...p.systemNotes,
      ...(opts.systemNotes
        ? Array.isArray(opts.systemNotes)
          ? opts.systemNotes
          : [opts.systemNotes]
        : []),
    ],
  };
}

export default {
  PRINCIPLES_VERSION,
  AUTONOMOUS_PRINCIPLES,
  principlesForLevel,
  applyPrinciplesToHarnessOpts,
};
