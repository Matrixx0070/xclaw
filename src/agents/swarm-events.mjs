/**
 * Swarm → WS bridge (Mandate-2 slice B5).
 *
 * The swarm emitted rich events (swarm_start / child_start / child_retry /
 * child_done / wave_* / merge_*) but nothing ever produced them on the
 * gateway's `swarm` WS channel — the Control UI subscribed to a channel with
 * no producer. This tee wraps input.onEvent once in runSwarmFanOut so EVERY
 * entry path (HTTP /swarm/run, mission swarm execute, agent xclaw_swarm_run
 * tool) broadcasts. Follows the globalThis.__xclawWsBroadcast pattern used
 * by admission/queue/eviction.
 */

export function emitSwarmWs(evt) {
  try {
    globalThis.__xclawWsBroadcast?.("swarm", evt);
  } catch {
    /* never break the swarm on a UI bridge */
  }
}

/** Wrap an onEvent callback so swarm events also hit the WS channel. */
export function teeSwarmEvents(onEvent, { swarmId = null } = {}) {
  return (e) => {
    try {
      emitSwarmWs(swarmId && e && !e.swarmId ? { swarmId, ...e } : e);
    } catch {}
    try {
      onEvent?.(e);
    } catch {}
  };
}
