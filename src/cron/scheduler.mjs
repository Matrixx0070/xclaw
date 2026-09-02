/**
 * XClaw cron scheduler — OpenClaw job/delivery/session-target semantics (subset).
 *
 * Durable: serializable job definitions (payload jobs without an in-process
 * handler) persist to the SQLite ledger ~/.xclaw/cron/jobs.sqlite and are
 * restored + re-armed by start(cfg) after a gateway restart. The legacy
 * ~/.xclaw/cron-jobs.json store is imported once on first start, then renamed
 * to .bak. Handler-backed jobs (doctor/eval/heartbeat/automations) are
 * process-owned and re-registered by their owners at boot, so they are
 * deliberately NOT persisted here.
 *
 * That re-registration is why an interval job needs `anchorKey`. A bare
 * {kind:"every"} schedule is relative — every boot recomputes nextRunAt from
 * now — so a job whose interval exceeds the gateway's uptime never reaches its
 * first run, silently, because a job that does not run logs nothing. Live
 * evidence (2026-08-28): the daily eval suite was registered at all 339 boots
 * in the log and started 6 times in 13 days, last completing 2026-08-17, with
 * a median inter-boot gap of 24 minutes against a 1440-minute interval.
 *
 * `anchorKey` opts a job into scheduling from its durable last-attempt stamp
 * (src/ops/due.mjs) instead of process uptime. It is opt-in because the
 * no-catch-up rule is correct for user payload jobs — nobody wants a restart
 * to burst the messages it missed — and wrong only for maintenance.
 */
import { randomUUID } from "node:crypto";
import { computeNextRun } from "./schedule.mjs";
import { readAnchorsSync, markArmed, markRan } from "../ops/due.mjs";
import {
  openCronLedger,
  absorbLegacyCronJson,
  legacyCronJsonFile,
  cronLedgerFile,
} from "./durable-jobs.mjs";
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
let ledger = null;

export function cronJobsPath(cfg) {
  // Kept for callers/tests that still ask for the old JSON path.
  return legacyCronJsonFile(cfg);
}

export function cronStorePath(cfg) {
  return cronLedgerFile(cfg);
}

/** Jobs with an in-process handler are owned by whoever registered them. */
function isPersistable(job) {
  return !job.handler && job.payload != null;
}

/** Breathing room so a catch-up run lands after boot, not during it. */
const ANCHOR_BOOT_GRACE_MS = 60_000;

/**
 * When a job should next run. Identical to computeNextRun unless the job is
 * anchored, in which case the schedule resumes from the durable stamp: an
 * overdue job runs shortly after boot, an up-to-date one waits out the
 * remainder of its interval rather than restarting it.
 *
 * A never-run anchored job still waits a full interval before its first run —
 * a fresh install must not launch an hour-long suite while it is booting — but
 * that interval is measured from a durable arm stamp, so it keeps counting
 * across restarts instead of resetting at each one.
 */
function anchorOf(job) {
  // Anchoring needs a config: without one there is no durable home to trust,
  // and a job registered bare (tests, ad-hoc callers) must not reach into the
  // real ~/.xclaw stamp file and speak for the running gateway.
  return job.anchorKey && job._cfg ? job.anchorKey : null;
}

function nextRunFor(job, now = Date.now()) {
  const anchor = anchorOf(job);
  if (!anchor || job.schedule?.kind !== "every") return computeNextRun(job.schedule, now);

  // A run stamp is the better epoch; the arm stamp is what lets a job that has
  // never run get there at all. Both are ignored if they sit in the future,
  // which means the clock moved back — fall through to the relative schedule
  // rather than parking the job until the stamp catches up.
  const { lastRun, armed } = readAnchorsSync(job._cfg);
  const epoch = [lastRun[anchor], armed[anchor]].find((t) => Number.isFinite(t) && t <= now);
  if (!Number.isFinite(epoch)) {
    // First sight of this job: start its clock durably, so the next boot
    // measures from here instead of recomputing the same distant first run.
    markArmed(job._cfg, anchor, now);
    return computeNextRun(job.schedule, now);
  }
  return Math.max(epoch + Number(job.schedule.everyMs || 0), now + ANCHOR_BOOT_GRACE_MS);
}

function serializeJob(job) {
  const { handler, _cfg, _lastAnnounce, ...rest } = job;
  return rest;
}

function persistJobs(cfg) {
  if (!ledger) return;
  try {
    const records = [...jobs.values()].filter(isPersistable).map(serializeJob);
    ledger.replace(records);
  } catch (err) {
    console.warn("[xclaw:cron] ledger write failed:", err.message);
  }
}

/**
 * Reload persisted job definitions and re-arm them. Idempotent — jobs whose
 * id is already registered are skipped. Corrupt/missing store → no-op.
 */
export function restorePersistedJobs(cfg, recordsFromLedger) {
  let records = recordsFromLedger;
  if (!records) {
    try {
      records = ledger ? ledger.list() : [];
    } catch (err) {
      console.warn("[xclaw:cron] ledger read failed:", err.message);
      return { ok: false, restored: 0, error: err.message };
    }
  }
  let restored = 0;
  const now = Date.now();
  for (const rec of records) {
    if (!rec || !rec.id || jobs.has(rec.id) || !rec.schedule) continue;
    // No catch-up for runs missed while down — schedule from now. Anchored
    // jobs opt out of that and resume from their stamp (see nextRunFor).
    const job = { ...rec, handler: null, _cfg: cfg || null, nextRunAt: null };
    job.nextRunAt = rec.enabled !== false ? nextRunFor(job, now) : null;
    if (job.schedule.kind === "at" && job.nextRunAt == null) job.enabled = false;
    jobs.set(job.id, job);
    restored += 1;
  }
  if (restored) armTimer();
  return { ok: true, restored };
}

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
  // Stamp the ATTEMPT, not the completion. A run cut short by a restart must
  // not re-arm at the next boot: the eval suite takes ~54 minutes against a
  // median uptime of 24, so stamping on completion would launch it at every
  // boot forever. At-most-once-per-interval is what a maintenance job wants;
  // the trade is that an interrupted run waits out its interval.
  if (anchorOf(job)) await markRan(job._cfg, job.anchorKey, job.lastRunAt);
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
  if (isPersistable(job)) persistJobs(job._cfg); // keep lastRunAt/status durable
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
    (input.everyMs
      ? { kind: "every", everyMs: input.everyMs }
      : input.intervalMs
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
    anchorKey: input.anchorKey || null,
    _cfg: input.cfg || null,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  if (job.enabled) job.nextRunAt = nextRunFor(job);
  jobs.set(id, job);
  if (isPersistable(job)) persistJobs(job._cfg);
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
  if (isPersistable(job)) persistJobs(job._cfg);
  armTimer();
  return job;
}

export function cancelJob(id) {
  const job = jobs.get(id);
  const wasPersistable = job ? isPersistable(job) : false;
  jobs.delete(id);
  if (wasPersistable) persistJobs(job._cfg);
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

export function start(cfg) {
  if (!ledger) {
    ledger = openCronLedger(cfg);
    if (ledger && ledger.list().length === 0) {
      absorbLegacyCronJson(ledger, legacyCronJsonFile(cfg));
    }
  }
  const restored = restorePersistedJobs(cfg, ledger ? ledger.list() : []);
  armTimer();
  return { ok: true, restored: restored.restored, ledger: ledger?.file ?? null };
}

export function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  // Drop persisted payload jobs from memory so the next start() re-hydrates
  // them from the ledger. Handler-backed jobs are owned by whoever registered
  // them (doctor/eval/heartbeat/automations) and must stay put.
  for (const [id, job] of jobs) {
    if (isPersistable(job)) jobs.delete(id);
  }
  try {
    ledger?.close();
  } catch {
    /* already closed */
  }
  ledger = null;
  return { ok: true };
}
