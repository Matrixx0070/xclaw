/**
 * Shared reading of approval lifecycle events.
 *
 * The agent loop emits `security/approval_required` twice for one pending: once
 * when it is created (carrying the tool arguments) and again as a state update
 * when authorize times out (carrying `restate: true` and no arguments). Every
 * channel that prompts a human has independently rediscovered this and grown
 * its own de-duplication — telegram first, webchat months later, each after a
 * user saw a bogus second prompt. Gate on these helpers instead.
 */

/** True when the event is a fresh ask that a human should be prompted with. */
export function isNewApprovalAsk(ev) {
  return Boolean(
    ev &&
      (ev.type === "security" || ev.event === "security") &&
      ev.phase === "approval_required" &&
      ev.restate !== true
  );
}

/** True when the event only restates a pending that was already announced. */
export function isApprovalRestate(ev) {
  return Boolean(
    ev &&
      (ev.type === "security" || ev.event === "security") &&
      ev.phase === "approval_required" &&
      ev.restate === true
  );
}

export default { isNewApprovalAsk, isApprovalRestate };
