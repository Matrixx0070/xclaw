/**
 * In-process CUA retry metrics (monitor + doctor).
 * Process-local by design; optional JSONL append for longer runs.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** @type {{
 *   startedAt: string,
 *   attempts: number,
 *   successes: number,
 *   failures: number,
 *   retries: number,
 *   retriedSuccesses: number,
 *   byCode: Record<string, { retries: number, finalOk: number, finalFail: number }>,
 *   delayMsTotal: number,
 *   delayMsMax: number,
 *   lastEvents: object[],
 * }} */
const state = {
  startedAt: new Date().toISOString(),
  attempts: 0,
  successes: 0,
  failures: 0,
  retries: 0,
  retriedSuccesses: 0,
  byCode: Object.create(null),
  delayMsTotal: 0,
  delayMsMax: 0,
  lastEvents: [],
};

const MAX_EVENTS = 50;

function bumpCode(code, field) {
  if (!code) code = "unknown";
  if (!state.byCode[code]) {
    state.byCode[code] = { retries: 0, finalOk: 0, finalFail: 0 };
  }
  state.byCode[code][field] += 1;
}

/**
 * Record a single retry sleep (from onRetry).
 */
export function recordCuaRetryTick({ attempt, delayMs, code, error } = {}) {
  state.retries += 1;
  const d = Number(delayMs) || 0;
  state.delayMsTotal += d;
  if (d > state.delayMsMax) state.delayMsMax = d;
  if (code) bumpCode(code, "retries");
  const ev = {
    at: new Date().toISOString(),
    type: "retry",
    attempt,
    delayMs: d,
    code: code || null,
    error: error ? String(error).slice(0, 160) : null,
  };
  state.lastEvents.push(ev);
  if (state.lastEvents.length > MAX_EVENTS) state.lastEvents.shift();
  appendJsonl(ev);
}

/**
 * Record final outcome of a withCuaRetry call.
 */
export function recordCuaRetryOutcome(result) {
  state.attempts += 1;
  const code = result?.code || (result?.ok ? "ok" : "unknown");
  if (result?.ok) {
    state.successes += 1;
    if (result.retried) state.retriedSuccesses += 1;
    bumpCode(result.retried ? `ok_after_retry` : "ok", "finalOk");
  } else {
    state.failures += 1;
    bumpCode(code, "finalFail");
  }
  const ev = {
    at: new Date().toISOString(),
    type: "outcome",
    ok: !!result?.ok,
    code: result?.ok ? "ok" : code,
    retries: result?.retries ?? 0,
    retried: !!result?.retried,
  };
  state.lastEvents.push(ev);
  if (state.lastEvents.length > MAX_EVENTS) state.lastEvents.shift();
  appendJsonl(ev);
}

function metricsPath() {
  const dir =
    process.env.XCLAW_CUA_METRICS_DIR ||
    path.join(process.env.HOME || os.homedir() || "/tmp", ".xclaw", "metrics");
  return path.join(dir, "cua-retry.jsonl");
}

function appendJsonl(ev) {
  if (process.env.XCLAW_CUA_METRICS === "0") return;
  try {
    const p = metricsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(ev) + "\n");
  } catch {
    /* metrics must never break the agent */
  }
}

/**
 * Snapshot for doctor / HTTP / tests.
 */
export function getCuaRetryMetrics() {
  const successRate =
    state.attempts > 0 ? state.successes / state.attempts : null;
  const avgDelay =
    state.retries > 0 ? state.delayMsTotal / state.retries : 0;
  return {
    ...state,
    byCode: { ...state.byCode },
    lastEvents: [...state.lastEvents],
    successRate,
    avgDelayMs: Math.round(avgDelay * 100) / 100,
    jsonlPath: metricsPath(),
  };
}

export function resetCuaRetryMetrics() {
  state.startedAt = new Date().toISOString();
  state.attempts = 0;
  state.successes = 0;
  state.failures = 0;
  state.retries = 0;
  state.retriedSuccesses = 0;
  state.byCode = Object.create(null);
  state.delayMsTotal = 0;
  state.delayMsMax = 0;
  state.lastEvents = [];
}

/**
 * Wrap withCuaRetry recording — use from computer_act / helpers.
 */
export function cuaRetryOnRetry(info) {
  recordCuaRetryTick(info);
}

export default {
  recordCuaRetryTick,
  recordCuaRetryOutcome,
  getCuaRetryMetrics,
  resetCuaRetryMetrics,
  cuaRetryOnRetry,
};
