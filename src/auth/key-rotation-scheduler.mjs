/**
 * Automated key rotation scheduler.
 *
 * Runs policy checks on an interval and when signing happens.
 * - startKeyRotationScheduler(cfg)  → background timer
 * - stopKeyRotationScheduler()
 * - onSignHook(cfg)                 → call from sign path
 * - runRotationOnce(cfg)            → single evaluation + maybe rotate
 */
import {
  ensureKeyStore,
  evaluateKeyRotation,
  maybeAutoRotate,
  recordKeyUse,
  keyRotationStatus,
  policy as keyPolicy,
} from "./key-rotation.mjs";

// policy is not exported — use maybeAutoRotate / evaluate only

let timer = null;
let running = false;
let lastResult = null;
let listeners = [];

export function onRotationEvent(fn) {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

function emit(event) {
  lastResult = { at: Date.now(), ...event };
  for (const fn of listeners) {
    try {
      fn(lastResult);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Single automated pass: ensure store, evaluate, rotate if due.
 */
export async function runRotationOnce(cfg = {}) {
  await ensureKeyStore(cfg);
  const ev = await evaluateKeyRotation(cfg);
  if (ev.action === "rotate") {
    const r = await maybeAutoRotate(cfg);
    emit({
      type: r.rotated ? "rotated" : "evaluate",
      evaluation: ev,
      result: r,
    });
    return r;
  }
  emit({ type: "evaluate", evaluation: ev });
  return { rotated: false, ...ev };
}

/**
 * Hook for sign path: record use (budget) then maybe auto-rotate.
 * Prefer this over raw recordKeyUse when automation is enabled.
 */
export async function onSignHook(cfg = {}) {
  // recordKeyUse already may rotate under budget when autoRotate
  const { recordKeyUse: rec, maybeAutoRotate: auto } = await import(
    "./key-rotation.mjs"
  );
  const used = await rec(cfg);
  if (used?.action === "rotated" || used?.ok === true && used.generation) {
    emit({ type: "rotated_on_use", result: used });
    return used;
  }
  const r = await auto(cfg);
  if (r.rotated) emit({ type: "rotated_on_use", result: r });
  return r;
}

/**
 * Start background scheduler.
 * @param {object} cfg
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] - check interval (default 60s)
 * @param {boolean} [opts.runImmediately=true]
 */
export function startKeyRotationScheduler(cfg = {}, opts = {}) {
  if (timer) {
    return { ok: true, alreadyRunning: true };
  }
  const intervalMs =
    Number(opts.intervalMs) > 0
      ? Number(opts.intervalMs)
      : Number(cfg.auth?.keys?.schedulerIntervalMs) > 0
        ? Number(cfg.auth.keys.schedulerIntervalMs)
        : 60_000;

  running = true;
  const tick = async () => {
    if (!running) return;
    try {
      await runRotationOnce(cfg);
    } catch (e) {
      emit({ type: "error", error: e.message || String(e) });
    }
  };

  if (opts.runImmediately !== false) {
    tick();
  }
  timer = setInterval(tick, intervalMs);
  // don't keep process alive solely for rotation unless requested
  if (timer.unref && opts.keepProcessAlive !== true) {
    timer.unref();
  }

  emit({ type: "scheduler_started", intervalMs });
  return { ok: true, intervalMs };
}

export function stopKeyRotationScheduler() {
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  emit({ type: "scheduler_stopped" });
  return { ok: true };
}

export function getSchedulerStatus() {
  return {
    running: Boolean(timer) && running,
    lastResult,
  };
}

/**
 * Wire automation into gateway boot.
 * Returns controls { stop, runOnce, status }.
 */
export async function installAutomatedKeyRotation(cfg = {}, opts = {}) {
  await ensureKeyStore(cfg);
  const started = startKeyRotationScheduler(cfg, opts);
  return {
    ...started,
    stop: () => stopKeyRotationScheduler(),
    runOnce: () => runRotationOnce(cfg),
    status: async () => ({
      scheduler: getSchedulerStatus(),
      keys: await keyRotationStatus(cfg),
    }),
  };
}
