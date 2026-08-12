/**
 * WebSocket reconnect with shared exponential / jittered backoff.
 * Uses src/utils/backoff.mjs (full jitter default).
 */

import {
  computeJitterDelay,
  fullJitterBackoffMs,
  decorrelatedBackoffMs,
  resolveJitterStrategy,
} from "./backoff.mjs";

/**
 * Delay before next WS reconnect attempt.
 * @param {number} attempt 0-based (0 = first reconnect after initial drop)
 * @param {object} [opts]
 * @param {string} [opts.strategy="full"]
 * @param {number} [opts.baseMs=1000]
 * @param {number} [opts.maxDelayMs=30000]
 * @param {number} [opts.prevDelayMs] for decorrelated
 */
export function wsReconnectDelayMs(attempt, opts = {}) {
  const strategy = resolveJitterStrategy(opts.strategy ?? "decorrelated");
  return computeJitterDelay(strategy, attempt, {
    baseMs: opts.baseMs ?? 1000,
    maxDelayMs: opts.maxDelayMs ?? 30_000,
    prevDelayMs: opts.prevDelayMs,
    random: opts.random,
  });
}

/**
 * Stateful reconnect scheduler (tracks attempt + prev delay for decorrelated).
 */
export function createWsReconnectScheduler(opts = {}) {
  let attempt = 0;
  let prevDelayMs = opts.baseMs ?? 1000;
  const strategy = resolveJitterStrategy(opts.strategy ?? "decorrelated");
  const baseMs = opts.baseMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;

  return {
    get attempt() {
      return attempt;
    },
    reset() {
      attempt = 0;
      prevDelayMs = baseMs;
    },
    /** @returns {number} delay ms for next reconnect */
    nextDelay() {
      const d = computeJitterDelay(strategy, attempt, {
        baseMs,
        maxDelayMs,
        prevDelayMs,
      });
      prevDelayMs = Math.max(1, d);
      attempt += 1;
      return d;
    },
  };
}

/**
 * Browser-oriented controller: call onClose → schedules reconnect with backoff.
 * Does not own WebSocket ctor details beyond callbacks.
 *
 * @param {object} opts
 * @param {() => void} opts.connect  open a new socket
 * @param {(s: string) => void} [opts.onStatus]
 * @param {string} [opts.strategy]
 * @param {number} [opts.baseMs]
 * @param {number} [opts.maxDelayMs]
 * @param {() => boolean} [opts.shouldReconnect] return false to stop
 */
export function createWsReconnectController(opts = {}) {
  const sched = createWsReconnectScheduler(opts);
  let timer = null;
  let stopped = false;

  function clear() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onOpen() {
    sched.reset();
    opts.onStatus?.("connected");
  }

  function onClose() {
    if (stopped) return;
    if (opts.shouldReconnect && !opts.shouldReconnect()) {
      opts.onStatus?.("stopped");
      return;
    }
    const delay = sched.nextDelay();
    opts.onStatus?.(`reconnecting:${sched.attempt}:${Math.round(delay)}ms`);
    clear();
    timer = setTimeout(() => {
      timer = null;
      try {
        opts.connect();
      } catch (e) {
        opts.onStatus?.(`error:${e.message || e}`);
        onClose();
      }
    }, delay);
  }

  function stop() {
    stopped = true;
    clear();
  }

  function start() {
    stopped = false;
    sched.reset();
    opts.connect();
  }

  return {
    start,
    stop,
    onOpen,
    onClose,
    get attempt() {
      return sched.attempt;
    },
  };
}

export { fullJitterBackoffMs, decorrelatedBackoffMs, resolveJitterStrategy };
export default {
  wsReconnectDelayMs,
  createWsReconnectScheduler,
  createWsReconnectController,
};
