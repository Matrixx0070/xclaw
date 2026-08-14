/**
 * WS event vocabulary (Mandate-2 slice B5) — frozen names, documented in
 * docs/ws-events.md. These are the shapes that already flow through the
 * system; this module freezes them so the UI and tests share one source.
 */

export const WS_CHANNELS = Object.freeze([
  "mission",
  "swarm",
  "security",
  "ops",
  "admission",
  "queue",
  "eviction",
]);

/** phases seen on the `swarm` channel (data.type === "swarm") */
export const SWARM_PHASES = Object.freeze([
  "swarm_start",
  "wave_start",
  "child_start",
  "child_retry",
  "child_done",
  "child_skip",
  "swarm_done",
  "swarm_aborted",
]);

/** phases seen on the `security` channel */
export const SECURITY_PHASES = Object.freeze([
  "approval_required",
  "approved",
  "denied",
  "plan_revalidated",
  "plan_revalidate_failed",
  "sandbox_denied",
  "egress_denied",
]);

/** event types tunneled through mission/swarm channels from agent loops */
export const AGENT_EVENT_TYPES = Object.freeze([
  "tool",
  "tokens",
  "model",
  "security",
  "router",
  "guard",
  "hook",
]);
