/**
 * Periodic computer health watchdog — restart if unhealthy.
 */
import { isComputerRunning, startComputer, stopComputer } from "./manager.mjs";
import { ensureComputer } from "./ensure.mjs";

let timer = null;
let running = false;
let restartCount = 0;
let lastRestartAt = null;
let lastRestartMs = 0;
let lastCheckAt = null;
let lastError = null;
let consecutiveFail = 0;

/**
 * @param {object} cfg
 * @param {{ root?: string, intervalMs?: number, enabled?: boolean }} [opts]
 */
export function startComputerWatchdog(cfg, opts = {}) {
  stopComputerWatchdog();
  const enabled = opts.enabled ?? cfg.computer?.watchdog?.enabled !== false;
  if (!enabled) return { ok: false, reason: "disabled" };

  const intervalMs =
    opts.intervalMs ??
    cfg.computer?.watchdog?.intervalMs ??
    30_000;
  const root = opts.root;

  timer = setInterval(() => {
    void tick(cfg, root);
  }, intervalMs);
  if (timer.unref) timer.unref();

  console.log(`[xclaw] computer watchdog every ${intervalMs}ms`);
  return { ok: true, intervalMs };
}

export function stopComputerWatchdog() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(cfg, root) {
  if (running) return;
  running = true;
  lastCheckAt = new Date().toISOString();
  try {
    if (await isComputerRunning(cfg)) {
      lastError = null;
      return;
    }
    const minGap =
      cfg.computer?.watchdog?.minRestartIntervalMs ?? 60_000;
    const maxFails =
      cfg.computer?.watchdog?.maxConsecutiveFails ?? 5;
    if (lastRestartMs && Date.now() - lastRestartMs < minGap) {
      lastError = `restart backoff (${Math.ceil((minGap - (Date.now() - lastRestartMs)) / 1000)}s left)`;
      console.warn(`[xclaw] computer watchdog: ${lastError}`);
      return;
    }
    if (consecutiveFail >= maxFails) {
      lastError = `circuit open after ${consecutiveFail} consecutive fails`;
      console.warn(`[xclaw] computer watchdog: ${lastError}`);
      return;
    }

    console.warn("[xclaw] computer watchdog: unhealthy — ensuring…");
    const r = await ensureComputer(cfg, { root, attempts: 2, log: true });
    if (!r.ok) {
      consecutiveFail += 1;
      lastError = r.error || "ensure failed";
      console.warn("[xclaw] computer watchdog: still down:", r.error);
    } else if (r.started) {
      restartCount += 1;
      lastRestartMs = Date.now();
      lastRestartAt = new Date().toISOString();
      consecutiveFail = 0;
      lastError = null;
      console.log(`[xclaw] computer watchdog: restarted OK (#${restartCount})`);
    } else {
      consecutiveFail = 0;
      lastError = null;
    }
  } catch (err) {
    lastError = err.message;
    console.warn("[xclaw] computer watchdog error:", err.message);
  } finally {
    running = false;
  }
}

export function watchdogStatus() {
  return {
    active: Boolean(timer),
    restartCount,
    lastRestartAt,
    lastCheckAt,
    lastError,
    consecutiveFail,
  };
}

/** Test helper — reset counters */
export function _resetWatchdogStats() {
  restartCount = 0;
  lastRestartAt = null;
  lastRestartMs = 0;
  lastCheckAt = null;
  lastError = null;
  consecutiveFail = 0;
}
