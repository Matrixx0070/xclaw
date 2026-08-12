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

/**
 * Full security gate used by the agent loop.
 * Handles authorize + pending/deny messaging + event emission + policy.
 *
 * @param {object} opts
 * @param {object} opts.approvalGate
 * @param {string} opts.name
 * @param {object} opts.args
 * @param {object} opts.cfg
 * @param {(e: object) => void} opts.onEvent
 * @param {(o: object) => string} opts.formatBlockedReply
 * @returns {Promise<{
 *   allowed: boolean,
 *   auth: object,
 *   isPending: boolean,
 *   pendingId: string|null,
 *   message: string|null,
 *   policy: object|null,
 *   lastPending: object|null,
 * }>}
 */
export async function authorizeToolInLoop({
  approvalGate,
  name,
  args,
  cfg,
  onEvent = () => {},
  formatBlockedReply,
}) {
  const auth = await authorizeToolCall({
    approvalGate,
    name,
    args,
    cfg,
    onEvent,
  });

  if (auth.ok) {
    if (auth.mode === "human") {
      emitAuthDecision({ onEvent, name, auth, phase: "approved" });
    }
    return {
      allowed: true,
      auth,
      isPending: false,
      pendingId: null,
      message: null,
      policy: policyFromAuth(auth, "allow"),
      lastPending: null,
    };
  }

  const isPending =
    auth.reason === "pending" ||
    auth.reason === "timeout" ||
    auth.pending === true ||
    Boolean(auth.pendingId);
  const pendingId = auth.pendingId || auth.id || null;

  const message = isPending
    ? formatBlockedReply({
        tool: name,
        reason: auth.reason || "awaiting approval",
        pendingId,
        argsPreview: JSON.stringify(args || {}).slice(0, 180),
      })
    : auth.message || `Tool ${name} blocked (${auth.reason || "denied"}).`;

  emitAuthDecision({
    onEvent,
    name,
    auth: { ...auth, message, pendingId },
    phase: isPending ? "approval_required" : "denied",
  });

  return {
    allowed: false,
    auth,
    isPending,
    pendingId,
    message,
    policy: policyFromAuth({ ...auth, pendingId }, isPending ? "pending" : "deny"),
    lastPending: isPending
      ? {
          id: pendingId,
          tool: name,
          args,
          reason: auth.reason || "pending",
          planFingerprint: auth.planFingerprint ?? null,
        }
      : null,
  };
}

export default {
  authorizeToolCall,
  policyFromAuth,
  emitAuthDecision,
  authorizeToolInLoop,
};
