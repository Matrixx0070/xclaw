/**
 * Which agent-loop events a connected voice client is told about, and in what
 * wire shape.
 *
 * A voice session runs the same agent loop as every other channel, so a tool
 * call on a voice turn pends for a human exactly as it does on Telegram or
 * webchat. The socket used to forward one shape only — `type === "tool"` with
 * phase start/end — so `security/approval_required` and `security/denied` were
 * dropped on the floor. Nothing else covered the gap: `produce()` in the
 * gateway is a per-SSE-stream writer, and a voice turn has no SSE stream, so
 * the ask reached no surface at all while `loop.mjs` waited out
 * `security.approvalTimeoutMs ?? 120_000`. Two minutes of silence on the one
 * surface where a person is holding a live conversation.
 *
 * Kept as a pure function because the call site is a closure inside
 * `runVoiceTurn`, reachable only by running a real agent turn over a real
 * WebSocket. The decision is testable; the plumbing is source-pinned.
 *
 * `text` is a ready-made announcement so a client does not re-derive the
 * wording (and does not have to know the tier vocabulary). It deliberately does
 * NOT tell the caller to say "approve": `src/voice/commands.mjs` has eight
 * intents and none of them approve anything. A pending is resolved through
 * `POST /approvals/approve`, which any client holding the pendingId can call —
 * naming a spoken command that does not exist would be worse than saying
 * nothing.
 */
import { isNewApprovalAsk } from "../security/approval-events.mjs";

/**
 * Security phases that mean "the tool did not run". Enumerated from the
 * producers (`loop.mjs`, `loop-stages.mjs`) rather than guessed, and kept as a
 * set because a hand-written two-phase condition here would be the same
 * narrowed allow-list that dropped the risk tier on webchat and the harness
 * flags on the queue: the caller needs to know the machine stopped, whichever
 * guard stopped it.
 */
const BLOCKED_PHASES = new Map([
  ["denied", "not approved"],
  ["sandbox_denied", "blocked by the sandbox"],
  ["egress_denied", "blocked by the egress policy"],
  ["receipt_required", "blocked pending a signed receipt"],
  ["quota_hard_circuit", "blocked by the quota circuit"],
  ["plan_revalidate_failed", "blocked because the plan changed"],
]);

/**
 * @param {object|null|undefined} e  event from the agent loop's onEvent
 * @param {{sessionId?: string}} ctx
 * @returns {object|null} the JSON frame to send, or null to stay silent
 */
export function voiceClientEvent(e, { sessionId } = {}) {
  if (!e || typeof e !== "object") return null;

  // Tool activity: unchanged wire shape. A client already renders these.
  if (e.type === "tool" && (e.phase === "start" || e.phase === "end")) {
    return { type: "event", event: "tool", phase: e.phase, name: e.name, sessionId };
  }

  // Only this turn's own events. The loop always sets `type`; the SSE-shaped
  // `{event: "security"}` variant belongs to a different run's stream, and
  // isNewApprovalAsk accepts it, so without this line another session's ask
  // would be announced to this caller under this sessionId.
  if (e.type !== "security") return null;

  if (e.phase === "approval_required") {
    // Every pending is emitted twice; the restate carries `restate: true`.
    // Announcing it twice on a voice surface talks over the caller, so the
    // shared primitive decides rather than a fourth hand-rolled dedup.
    if (!isNewApprovalAsk(e)) return null;
    const name = e.name || "a tool";
    const tier = e.riskTier || null;
    return {
      type: "event",
      event: "approval_required",
      pendingId: e.pendingId || null,
      name: e.name || null,
      // An absent tier stays absent. A security label that guesses "safe" is
      // worse than one that abstains.
      riskTier: tier,
      text: `Approval needed to run ${name}.${tier ? ` Risk: ${tier}.` : ""} The turn is paused until it is approved.`,
      sessionId,
    };
  }

  const why = BLOCKED_PHASES.get(e.phase);
  if (why) {
    const name = e.name || "a tool";
    return {
      type: "event",
      event: "blocked",
      phase: e.phase,
      pendingId: e.pendingId || null,
      name: e.name || null,
      text: `${name} was ${why}.`,
      sessionId,
    };
  }

  return null;
}

export default { voiceClientEvent };
