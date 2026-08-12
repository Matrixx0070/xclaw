/**
 * C1 — Auto-renew tab leases while held.
 *
 * startLeaseHeartbeat(tabId, opts) → interval calls renewTabLease
 * stopLeaseHeartbeat(tabId)
 * touchLease(tabId, opts) → single renew (also used after each successful act)
 *
 * Env:
 *   XCLAW_TAB_LEASE_HEARTBEAT=0     disable auto interval
 *   XCLAW_TAB_LEASE_HEARTBEAT_MS    interval (default ttl/3 or 40s)
 *   XCLAW_TAB_LEASE_TTL_MS          lease TTL (physics default 120s)
 */

import { renewTabLease, acquireTabLease } from "./physics.mjs";

/** @type {Map<string, { timer: NodeJS.Timeout, agentId: string, opts: object }>} */
const heartbeats = new Map();

function ttlMs() {
  return Number(process.env.XCLAW_TAB_LEASE_TTL_MS || 120_000);
}

function heartbeatMs() {
  const env = Number(process.env.XCLAW_TAB_LEASE_HEARTBEAT_MS);
  if (Number.isFinite(env) && env >= 5_000) return env;
  return Math.max(15_000, Math.floor(ttlMs() / 3));
}

function heartbeatEnabled() {
  const v = process.env.XCLAW_TAB_LEASE_HEARTBEAT;
  if (v === "0" || v === "false") return false;
  return true; // default on when fabric is in use
}

/**
 * One-shot renew (safe to call often).
 */
export async function touchLease(tabId, opts = {}) {
  const id = String(tabId || "").trim();
  if (!id) return { ok: false, code: "TAB_REQUIRED" };
  const agentId =
    opts.agentId || process.env.XCLAW_AGENT_ID || process.env.XCLAW_SESSION_ID;
  try {
    return await renewTabLease(id, {
      agentId,
      ttlMs: opts.ttlMs || ttlMs(),
      force: opts.force,
    });
  } catch (e) {
    return { ok: false, code: "RENEW_ERROR", reason: e?.message || String(e) };
  }
}

/**
 * Start periodic renew for a tab. Idempotent (resets interval).
 */
export function startLeaseHeartbeat(tabId, opts = {}) {
  const id = String(tabId || "").trim();
  if (!id) return { ok: false, code: "TAB_REQUIRED" };
  if (!heartbeatEnabled()) {
    return { ok: true, skipped: true, reason: "heartbeat disabled" };
  }

  stopLeaseHeartbeat(id);

  const agentId =
    opts.agentId || process.env.XCLAW_AGENT_ID || process.env.XCLAW_SESSION_ID;
  const interval = opts.intervalMs || heartbeatMs();

  const timer = setInterval(() => {
    touchLease(id, { agentId, ttlMs: opts.ttlMs }).then((r) => {
      if (!r.ok && process.env.XCLAW_DEBUG_LEASE === "1") {
        console.error("[xclaw:lease-heartbeat] renew failed", id, r.code, r.reason);
      }
      // stop if lease gone / stolen
      if (
        r.code === "TAB_LEASE_MISSING" ||
        r.code === "TAB_LEASE_HELD" ||
        r.code === "TAB_LEASE_EXPIRED"
      ) {
        stopLeaseHeartbeat(id);
      }
    }).catch(() => {});
  }, interval);

  // don't keep process alive solely for heartbeats
  if (typeof timer.unref === "function") timer.unref();

  heartbeats.set(id, { timer, agentId, opts, intervalMs: interval });
  return { ok: true, tabId: id, intervalMs: interval, agentId };
}

export function stopLeaseHeartbeat(tabId) {
  const id = String(tabId || "").trim();
  const rec = heartbeats.get(id);
  if (!rec) return { ok: true, stopped: false };
  clearInterval(rec.timer);
  heartbeats.delete(id);
  return { ok: true, stopped: true, tabId: id };
}

export function stopAllLeaseHeartbeats() {
  for (const id of [...heartbeats.keys()]) stopLeaseHeartbeat(id);
  return { ok: true };
}

export function listLeaseHeartbeats() {
  return [...heartbeats.entries()].map(([tabId, rec]) => ({
    tabId,
    agentId: rec.agentId,
    intervalMs: rec.intervalMs,
  }));
}

/**
 * Acquire (or re-acquire) lease and start heartbeat.
 */
export async function acquireWithHeartbeat(tabId, opts = {}) {
  const acq = await acquireTabLease(tabId, opts);
  if (!acq.ok) return acq;
  const hb = startLeaseHeartbeat(tabId, {
    agentId: opts.agentId || acq.lease?.agentId,
    ttlMs: opts.ttlMs,
    intervalMs: opts.intervalMs,
  });
  return { ...acq, heartbeat: hb };
}

/**
 * Release path helper: stop heartbeat (caller still releases lease).
 */
export function onLeaseReleased(tabId) {
  return stopLeaseHeartbeat(tabId);
}

export default {
  touchLease,
  startLeaseHeartbeat,
  stopLeaseHeartbeat,
  stopAllLeaseHeartbeats,
  listLeaseHeartbeats,
  acquireWithHeartbeat,
  onLeaseReleased,
};
