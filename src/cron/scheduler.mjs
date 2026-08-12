/**
 * XClaw cron scheduler — OpenClaw job/delivery/session-target semantics (subset).
 */
import { randomUUID } from "node:crypto";
import { computeNextRun } from "./schedule.mjs";
import {
  resolveCronCreationDelivery,
  resolveJobDeliverySessionKey,
  resolveJobNotificationKey,
  shouldDefaultCronDeliveryToAnnounce,
} from "./delivery.mjs";
import { resolveCurrentSessionTarget } from "../sessions/session-target.mjs";
import { announceCronJob } from "./announce.mjs";
import { appendCronEvent } from "./logs.mjs";
import { getSharedAlerter } from "../alerting/alerts.mjs";

const jobs = new Map();
const hooks = new Map();
let timer = null;
let running = false;

export function on(event, fn) {
  if (!hooks.has(event)) hooks.set(event, []);
  hooks.get(event).push(fn);
  return () => {
    const arr = hooks.get(event) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
}

export async function emit(event, payload) {
  for (const fn of hooks.get(event) || []) {
    try {
      await fn(payload);
    } catch (err) {
      console.error(`[xclaw:hook] ${event}`, err.message);
    }
  }
}

function armTimer() {
  if (timer) clearTimeout(timer);
  let next = null;
  for (const j of jobs.values()) {
    if (!j.enabled || j.nextRunAt == null) continue;
    if (next == null || j.nextRunAt < next) next = j.nextRunAt;
  }
  if (next == null) return;
  const delay = Math.max(50, next - Date.now());
  timer = setTimeout(() => {
    void tick();
  }, delay);
  if (timer.unref) timer.unref();
}

async function tick() {
  if (running) return;
  running = true;
  const now = Date.now();
  try {
    for (const job of [...jobs.values()]) {
      if (!job.enabled || job.nextRunAt == null || job.nextRunAt > now) continue;
      await runJob(job, { mode: "due" });
    }
  } finally {
    running = false;
    armTimer();
  }
}

async function runJob(job, opts = {}) {
  job.lastRunAt = Date.now();
  try {
    await emit("cron:before", { id: job.id, name: job.name, job });
    if (typeof job.handler === "function") {
      await job.handler(job);
    } else if (job.payload?.message || job.payload?.text || job.payload?.prompt) {
      // Default: run agent and emit delivery for channel adapters
      const ann = await announceCronJob(job, { cfg: job._cfg || {} });
      job._lastAnnounce = ann.delivery;
    }
    await emit("cron:after", { id: job.id, name: job.name, ok: true, job });
    await emit("cron:delivery", {
      id: job.id,
      delivery: job.delivery,
      sessionKey: resolveJobDeliverySessionKey(job),
      notificationKey: resolveJobNotificationKey(job),
    });
    job.lastStatus = "ok";
    job.lastError = null;
    appendCronEvent(job._cfg || {}, {
      type: "end",
      id: job.id,
      name: job.name,
      ok: true,
    });
  } catch (err) {
    job.lastStatus = "error";
    job.lastError = err.message || String(err);
    appendCronEvent(job._cfg || {}, {
      type: "end",
      id: job.id,
      name: job.name,
      ok: false,
      error: job.lastError,
    });
    try {
      await getSharedAlerter(job._cfg || {}).alertCronJobError(job, job.lastError);
    } catch {}
    await emit("cron:after", {
      id: job.id,
      name: job.name,
      ok: false,
      error: job.lastError,
      job,
    });
  }

  if (job.schedule?.kind === "at") {
    job.enabled = false;
    job.nextRunAt = null;
  } else {
    job.nextRunAt = computeNextRun(job.schedule, Date.now());
  }
  armTimer();
  return job;
}

/**
 * Add a job (OpenClaw-like input).
 */
export function addJob(input = {}) {
  const id = input.id || randomUUID();
  const schedule =
    input.schedule ||
    (input.intervalMs
      ? { kind: "every", everyMs: input.intervalMs }
      : { kind: "every", everyMs: 60_000 });

  const sessionTarget = resolveCurrentSessionTarget({
    sessionTarget: input.sessionTarget,
    sessionKey: input.sessionKey,
  });

  let delivery = input.delivery || null;
  if (!delivery && input.sessionKey) {
    delivery = resolveCronCreationDelivery({
      agentSessionKey: input.sessionKey,
      currentDeliveryContext: input.deliveryContext,
    });
  }
  if (
    delivery &&
    !shouldDefaultCronDeliveryToAnnounce({
      sessionTarget,
      sessionKey: input.sessionKey,
      delivery,
      payloadKind: input.payload?.kind,
    })
  ) {
    delivery = { ...delivery, mode: "none" };
  }

  const job = {
    id,
    name: input.name || "job",
    enabled: input.enabled !== false,
    schedule,
    sessionTarget,
    sessionKey: input.sessionKey || null,
    delivery,
    payload: input.payload || null,
    agentId: input.agentId || null,
    handler: input.handler || null,
    _cfg: input.cfg || null,
    nextRunAt: input.enabled === false ? null : computeNextRun(schedule, Date.now()),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  armTimer();
  return job;
}

/** @deprecated use addJob */
export function scheduleJob(opts = {}) {
  return addJob({
    name: opts.name,
    intervalMs: opts.intervalMs,
    enabled: opts.enabled,
    handler: opts.handler,
    sessionKey: opts.sessionKey,
    sessionTarget: opts.sessionTarget,
    delivery: opts.delivery,
  }).id;
}

export function updateJob(id, patch = {}) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  if (patch.schedule || patch.enabled != null) {
    job.nextRunAt = job.enabled ? computeNextRun(job.schedule, Date.now()) : null;
  }
  armTimer();
  return job;
}

export function cancelJob(id) {
  jobs.delete(id);
  armTimer();
}

export function removeJob(id) {
  cancelJob(id);
  return { ok: true, id };
}

export function getJob(id) {
  return jobs.get(id);
}

export function listJobs({ includeDisabled = true } = {}) {
  return [...jobs.values()]
    .filter((j) => includeDisabled || j.enabled)
    .map(({ handler, ...rest }) => rest);
}

export async function run(id, mode = "manual") {
  const job = jobs.get(id);
  if (!job) return { ok: false, error: "not_found" };
  await runJob(job, { mode });
  return { ok: true, job: getJob(id) };
}

export function status() {
  const list = listJobs();
  return {
    jobs: list.length,
    enabled: list.filter((j) => j.enabled).length,
    nextRunAt: list
      .filter((j) => j.nextRunAt != null)
      .map((j) => j.nextRunAt)
      .sort((a, b) => a - b)[0] ?? null,
  };
}

export function start() {
  armTimer();
  return { ok: true };
}

export function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  return { ok: true };
}
