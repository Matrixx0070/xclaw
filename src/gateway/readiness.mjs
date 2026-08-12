/**
 * Readiness probe for load balancers / k8s-style checks.
 * Ready = computer healthy (if required) and queue not critically backed up.
 */
import { isComputerRunning } from "../computer/manager.mjs";
import { queueStats } from "../jobs/queue.mjs";

/**
 * @param {object} cfg
 * @returns {Promise<{ ready: boolean, status: number, body: object }>}
 */
export async function checkReadiness(cfg) {
  const requireComputer = cfg.readiness?.requireComputer !== false;
  const maxQueued = cfg.readiness?.maxQueued ?? 100;

  const checks = {};
  let ready = true;

  let computerUp = false;
  try {
    computerUp = await isComputerRunning(cfg);
  } catch (e) {
    checks.computer = { ok: false, error: e.message };
  }
  checks.computer = checks.computer || { ok: computerUp };
  if (requireComputer && !computerUp) ready = false;

  let q = null;
  try {
    q = await queueStats(cfg);
    checks.queue = {
      ok: (q.queued || 0) <= maxQueued,
      queued: q.queued,
      running: q.running,
      maxQueued,
    };
    if ((q.queued || 0) > maxQueued) ready = false;
  } catch (e) {
    checks.queue = { ok: false, error: e.message };
    // queue probe failure is soft unless configured strict
    if (cfg.readiness?.strictQueue) ready = false;
  }

  checks.gateway = { ok: true };

  return {
    ready,
    status: ready ? 200 : 503,
    body: {
      status: ready ? "ready" : "not_ready",
      ready,
      checks,
      at: new Date().toISOString(),
    },
  };
}
