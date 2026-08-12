/**
 * Admission control for XClaw job/agent queues.
 *
 * Draws on Erlang A (deterministic patience) + Halfin–Whitt staffing:
 *   - max concurrency c  (servers)
 *   - max queue depth K  (finite buffer → reject when full)
 *   - max wait T         (deterministic patience → abandon/timeout)
 *   - optional QED hint: c ≈ a + β√a
 *
 * Metrics: admitted, rejected_full, abandoned_wait, completed, timed_out_job
 */

/**
 * Halfin–Whitt / QED safety staffing.
 * @param {number} a  offered load in Erlangs (λ/μ), must be >= 0
 * @param {number} [beta=1] safety factor
 * @returns {number} recommended integer server count (>=1)
 */
export function qedStaffing(a, beta = 1) {
  const load = Math.max(0, Number(a) || 0);
  const b = Number.isFinite(Number(beta)) ? Number(beta) : 1;
  const c = load + b * Math.sqrt(Math.max(load, 0));
  return Math.max(1, Math.ceil(c));
}

/**
 * Estimate offered load a = λ * E[S] from recent rates.
 * @param {{ arrivalsPerSec: number, meanServiceSec: number }} rates
 */
export function offeredLoadErl(rates = {}) {
  const lam = Math.max(0, Number(rates.arrivalsPerSec) || 0);
  const es = Math.max(0, Number(rates.meanServiceSec) || 0);
  return lam * es;
}

/**
 * @typedef {object} AdmissionConfig
 * @property {number} [concurrency=1]
 * @property {number} [maxDepth=100]     max queued (not running) items
 * @property {number} [maxWaitMs=300000] deterministic patience while queued
 * @property {number} [maxConcurrencyCap=16]
 */

/**
 * @typedef {object} AdmissionDecision
 * @property {boolean} admit
 * @property {string} [reason]  full | paused | overloaded
 * @property {object} snapshot
 */

/**
 * Create an in-process admission controller (metrics + policy checks).
 * Pair with persistent queue for actual job storage.
 *
 * @param {AdmissionConfig} [cfg]
 */

function emitAdmission(channel, data) {
  try {
    const fn = globalThis.__xclawWsBroadcast;
    if (typeof fn === "function") fn(channel, data);
  } catch {
    /* hub not up */
  }
}

export function createAdmissionController(cfg = {}) {
  const maxConcurrencyCap = Math.max(1, Number(cfg.maxConcurrencyCap) || 16);
  let concurrency = clampInt(cfg.concurrency ?? 1, 1, maxConcurrencyCap);
  let maxDepth = Math.max(0, Number(cfg.maxDepth) ?? 100);
  let maxWaitMs = Math.max(0, Number(cfg.maxWaitMs) ?? 300_000);

  const metrics = {
    admitted: 0,
    rejectedFull: 0,
    abandonedWait: 0,
    completed: 0,
    failed: 0,
    timedOutJob: 0,
  };

  function clampInt(n, lo, hi) {
    const x = Math.floor(Number(n));
    if (!Number.isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function snapshot(extra = {}) {
    return {
      concurrency,
      maxDepth,
      maxWaitMs,
      maxConcurrencyCap,
      metrics: { ...metrics },
      ...extra,
    };
  }

  /**
   * Should a new job be accepted given current queue depth (queued only)?
   * @param {{ queued: number, running?: number, paused?: boolean }} state
   * @returns {AdmissionDecision}
   */
  function tryAdmit(state = {}) {
    if (state.paused) {
      return { admit: false, reason: "paused", snapshot: snapshot(state) };
    }
    const queued = Math.max(0, Number(state.queued) || 0);
    if (maxDepth >= 0 && queued >= maxDepth) {
      metrics.rejectedFull += 1;
      emitAdmission("admission", { kind: "rejected_full", metrics: { ...metrics }, state });
      return { admit: false, reason: "full", snapshot: snapshot(state) };
    }
    metrics.admitted += 1;
    emitAdmission("admission", { kind: "admitted", metrics: { ...metrics }, state });
    return { admit: true, snapshot: snapshot(state) };
  }

  /**
   * Deterministic patience: true if queued item should abandon.
   * @param {{ createdAt?: string, enqueuedAt?: string }} item
   * @param {number} [now]
   */
  function shouldAbandon(item, now = Date.now()) {
    if (!(maxWaitMs > 0)) return false;
    const t = Date.parse(item.enqueuedAt || item.createdAt || "") || now;
    return now - t >= maxWaitMs;
  }

  function recordAbandon() {
    metrics.abandonedWait += 1;
    emitAdmission("admission", { kind: "abandoned_wait", metrics: { ...metrics } });
  }

  function recordComplete(ok) {
    if (ok) metrics.completed += 1;
    else metrics.failed += 1;
    emitAdmission("admission", {
      kind: ok ? "completed" : "failed",
      metrics: { ...metrics },
    });
  }

  function recordJobTimeout() {
    metrics.timedOutJob += 1;
  }

  function configure(next = {}) {
    if (next.concurrency != null) {
      concurrency = clampInt(next.concurrency, 1, maxConcurrencyCap);
    }
    if (next.maxDepth != null) maxDepth = Math.max(0, Number(next.maxDepth));
    if (next.maxWaitMs != null) maxWaitMs = Math.max(0, Number(next.maxWaitMs));
    return snapshot();
  }

  /**
   * Suggest concurrency from observed load (QED).
   * @param {{ arrivalsPerSec: number, meanServiceSec: number, beta?: number }} rates
   */
  function suggestConcurrency(rates = {}) {
    const a = offeredLoadErl(rates);
    const beta = rates.beta != null ? Number(rates.beta) : 1;
    const suggested = qedStaffing(a, beta);
    return {
      a,
      beta,
      suggested: Math.min(maxConcurrencyCap, suggested),
      current: concurrency,
    };
  }

  return {
    tryAdmit,
    shouldAbandon,
    recordAbandon,
    recordComplete,
    recordJobTimeout,
    configure,
    suggestConcurrency,
    snapshot,
    get concurrency() {
      return concurrency;
    },
    get maxDepth() {
      return maxDepth;
    },
    get maxWaitMs() {
      return maxWaitMs;
    },
  };
}

/** Process-wide default controller (lazy). */
let _default = null;
export function getDefaultAdmission(cfg) {
  if (!_default) {
    _default = createAdmissionController({
      concurrency: cfg?.queue?.concurrency,
      maxDepth: cfg?.queue?.maxDepth,
      maxWaitMs: cfg?.queue?.maxWaitMs,
      maxConcurrencyCap: cfg?.queue?.maxConcurrencyCap,
    });
  } else if (cfg?.queue) {
    _default.configure({
      concurrency: cfg.queue.concurrency,
      maxDepth: cfg.queue.maxDepth,
      maxWaitMs: cfg.queue.maxWaitMs,
    });
  }
  return _default;
}

export default {
  qedStaffing,
  offeredLoadErl,
  createAdmissionController,
  getDefaultAdmission,
};
