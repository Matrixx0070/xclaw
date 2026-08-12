/**
 * Authorize a tool call via the shared approval gate and normalize
 * security events + toolTrace policy payloads (including systemRunPlan).
 *
 * Extracted so agent/loop.mjs stays thinner and plan fingerprints
 * always flow into events and receipts.
 */

/**
 * @param {object} opts
 * @param {object} opts.approvalGate
 * @param {string} opts.name
 * @param {object} opts.args
 * @param {object} opts.cfg
 * @param {(e: object) => void} opts.onEvent
 * @returns {Promise<object>} auth result from gate.authorize
 */
export async function authorizeToolCall({
  approvalGate,
  name,
  args,
  cfg,
  onEvent = () => {},
}) {
  const auth = await approvalGate.authorize(name, args, {
    timeoutMs: cfg?.security?.approvalTimeoutMs ?? 120_000,
    onPending: (info) => {
      onEvent({
        type: "security",
        phase: "approval_required",
        pendingId: info.id,
        name: info.tool,
        args: info.args,
        planFingerprint: info.planFingerprint ?? null,
        plan: info.plan ?? null,
      });
    },
  });
  return auth;
}

/**
 * Build a toolTrace policy object from an auth result.
 * @param {object} auth
 * @param {"allow"|"deny"|"pending"} decision
 */
export function policyFromAuth(auth, decision) {
  const base = {
    phase: "approval",
    decision,
    reason: auth?.reason || decision,
    pendingId: auth?.pendingId || auth?.id || null,
    mode: auth?.mode || null,
    planFingerprint: auth?.planFingerprint ?? null,
  };
  if (auth?.plan) {
    base.plan = {
      fingerprint: auth.plan.fingerprint || auth.planFingerprint,
      tool: auth.plan.tool,
      command: auth.plan.command,
      argv: auth.plan.argv,
      cwd: auth.plan.cwd,
      exe: auth.plan.exe,
    };
  }
  return base;
}

/**
 * Emit approved/denied security event with plan binding.
 * @param {object} opts
 */
export function emitAuthDecision({ onEvent, name, auth, phase }) {
  onEvent({
    type: "security",
    phase,
    name,
    mode: auth?.mode,
    note: auth?.note,
    reason: auth?.reason,
    pendingId: auth?.pendingId || null,
    planFingerprint: auth?.planFingerprint ?? null,
    plan: auth?.plan ?? null,
    message: auth?.message,
  });
}

export default {
  authorizeToolCall,
  policyFromAuth,
  emitAuthDecision,
};
