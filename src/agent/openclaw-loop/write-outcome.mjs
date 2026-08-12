/**
 * Adapted from OpenClaw (MIT) — src/agents/tool-loop-write-outcome.ts
 */
export function isWriteNoProgressOutcome(details) {
  return details && details.changed === false;
}
