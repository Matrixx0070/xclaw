/**
 * Graceful shutdown: pause queue, wait for running jobs, stop computer optional.
 */
import { pauseQueue, queueStats } from "../jobs/queue.mjs";

/**
 * @param {object} cfg
 * @param {{ timeoutMs?: number, onLog?: (s: string) => void }} [opts]
 */
export async function gracefulShutdown(cfg, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? cfg.shutdown?.drainMs ?? 15_000;
  const log = opts.onLog || ((s) => console.log(`[xclaw] ${s}`));

  log("graceful shutdown: pausing queue");
  pauseQueue();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let running = 0;
    try {
      const s = await queueStats(cfg);
      running = s.running || s.worker?.running || 0;
    } catch {
      break;
    }
    if (running <= 0) {
      log("queue drained");
      return { ok: true, drained: true, waitedMs: Date.now() - start };
    }
    log(`waiting for ${running} running job(s)…`);
    await new Promise((r) => setTimeout(r, 500));
  }
  log("drain timeout — proceeding");
  return { ok: true, drained: false, waitedMs: Date.now() - start };
}
