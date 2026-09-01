/**
 * Multi-job queue — bounded concurrency with admission control (X1).
 * Jobs are persisted under <configDir>/job-queue/.
 *
 * job-queue belongs to the config dir that owns the instance, not to
 * whoever's home dir the process happens to run under. Resolving it from
 * `os.homedir()` alone meant two instances on one host shared a single
 * queue, so instance B drained instance A's jobs — and the suite wrote
 * into the operator's real `~/.xclaw/job-queue/`.
 *
 * Production writers (`enqueueJob(cfg)` at channels/commands and
 * gateway/routes/eval-queue) already had cfg in scope. `loadConfig()`
 * stamps `paths.configDir` unconditionally (config/load.mjs:187), so a
 * cfg without one is never a real caller. Such a path is `null` rather
 * than guessing at the home dir. Same shape as `lastDrainPath`. Honour
 * existing `XCLAW_CONFIG_DIR`. `ensureDir` no-ops a null path (do not
 * `mkdir(null)`). `listQueue` returns `[]`. `enqueueJob` still returns
 * the record without persisting.
 *
 * cfg.queue: concurrency, maxDepth, maxWaitMs, maxConcurrencyCap
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runJob, saveJobSummary } from "./job.mjs";
import { recordJob } from "./history.mjs";
import { getCostGovernorStatus } from "../tokens/cost-governor.mjs";
import { getDefaultAdmission } from "../utils/admission.mjs";

function emitQueue(data) {
  try {
    const fn = globalThis.__xclawWsBroadcast;
    if (typeof fn === "function") fn("queue", data);
  } catch {
    /* */
  }
}


/**
 * Every status a queue item can hold. `abandoned` (patience budget exhausted)
 * was known only to the code that writes it: /metrics enumerated five statuses
 * and clearCompletedQueue three, so an abandoned job was invisible to scrapers
 * and could never be removed — and listQueue reads every file in the dir on
 * every call, so an unremovable record taxes every enqueue and every scrape.
 * One list, exported, so a new status cannot be added to only half the system.
 */
export const QUEUE_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "abandoned",
];

/** Statuses where the item is finished: safe to clear, never re-run. */
export const TERMINAL_QUEUE_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "abandoned",
];

/** Priority classes: higher number runs first; aging bumps batch/cron over time */
export const PRIORITY_CLASS = {
  interactive: 100,
  batch: 50,
  cron: 20,
};

export function resolvePriority(item = {}) {
  if (typeof item.priority === "number") return item.priority;
  const cls = item.class || item.priorityClass || "batch";
  return PRIORITY_CLASS[cls] ?? PRIORITY_CLASS.batch;
}

function agedPriority(item, now = Date.now()) {
  const base = resolvePriority(item);
  const created = Date.parse(item.createdAt || "") || now;
  const ageMin = Math.max(0, (now - created) / 60000);
  // +1 per 5 minutes waiting, cap +40 — prevents batch starvation under interactive load
  const bump = Math.min(40, Math.floor(ageMin / 5));
  return base + bump;
}

/**
 * Honour `paths.configDir` then `XCLAW_CONFIG_DIR` then null.
 * No home fallback.
 */
export function queueDir(cfg = {}) {
  const dir = cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR;
  return dir ? path.join(dir, "job-queue") : null;
}

async function ensureDir(cfg) {
  const dir = queueDir(cfg);
  if (!dir) return null;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** @type {{ cfg: object, running: number, timer: any, paused: boolean }} */
let worker = null;

function maxConcurrency(cfg) {
  const cap = Math.max(1, Number(cfg?.queue?.maxConcurrencyCap) || 16);
  const n = Number(cfg?.queue?.concurrency ?? 1);
  const v = Number.isFinite(n) ? n : 1;
  return Math.max(1, Math.min(cap, v));
}

function maxDepth(cfg) {
  const d = Number(cfg?.queue?.maxDepth);
  return Number.isFinite(d) && d >= 0 ? d : 100;
}

function maxWaitMsCfg(cfg) {
  const w = Number(cfg?.queue?.maxWaitMs);
  return Number.isFinite(w) && w >= 0 ? w : 300_000;
}

/**
 * Enqueue a job definition.
 * @param {object} cfg
 * @param {{ goal: string, verify?: object[], maxTurns?: number, priority?: number }} item
 */
/**
 * The fields an enqueue REQUEST may carry, in one place.
 *
 * The gateway owns the queue, so a job asked for by another process arrives as
 * a request body. Every field enqueueJob() honours has to survive that trip:
 * the route used to forward goal|verify|maxTurns|priority only, so a harness
 * job posted over HTTP silently lost `harness`, `class` and all three grounding
 * flags and ran as a plain batch job. Retry/wait ceilings are deliberately NOT
 * accepted from a request — those stay config-owned.
 *
 * The other half of that contract is WITHHELD_REQUEST_FIELDS: a field this
 * function drops on purpose is not a bug, but a caller has no way to tell the
 * two apart from a 202. Naming the withheld fields — and why — is what lets the
 * route say so and keeps docs/QUEUE.md from advertising them again.
 *
 * @param {object} body
 * @returns {object} an item for enqueueJob
 */
/**
 * Fields enqueueJob honours that a REQUEST may not set, each with the reason.
 *
 * Anyone holding the gateway token can POST /queue, so these are levers, not
 * conveniences: `maxWaitMs: 10**9` is a job that is never abandoned, and
 * `maxAttempts: 99` is ninety-nine runs of it. They stay config-owned
 * (queue.maxWaitMs, docs/ADMISSION_CONTROL.md).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const WITHHELD_REQUEST_FIELDS = Object.freeze({
  maxAttempts: "retry budget is config-owned (queue.maxAttempts)",
  maxWaitMs: "admission wait is config-owned (queue.maxWaitMs)",
  priorityClass: "alias read internally — send `class` instead",
});

/**
 * Which withheld fields a body actually tried to set, so the caller hears about
 * the ones they sent and nothing else.
 *
 * @param {object} body
 * @returns {string[]}
 */
export function withheldRequestFields(body = {}) {
  return Object.keys(WITHHELD_REQUEST_FIELDS).filter((k) => body?.[k] !== undefined);
}

export function pickEnqueueRequest(body = {}) {
  return {
    goal: body.goal || body.message,
    verify: body.verify || [],
    workspace: body.workspace,
    maxTurns: body.maxTurns,
    timeoutMs: body.timeoutMs,
    harness: body.harness,
    groundHard: body.groundHard,
    claimsRequireEvidence: body.claimsRequireEvidence,
    requireStructuredClaims: body.requireStructuredClaims,
    priority: body.priority,
    class: body.class,
  };
}

export async function enqueueJob(cfg, item) {
  if (!item?.goal) throw new Error("goal required");

  // Admission: finite buffer (maxDepth) + pause
  const adm = getDefaultAdmission(cfg);
  // Captured before the await below: countQueued's fs I/O yields the event
  // loop, and the singleton's stored bounds are rewritten by any concurrent
  // configure (processNext does one per pick, with ITS cfg). The decision
  // must enforce THIS cfg's bound, so it travels with the call.
  const depthBound = maxDepth(cfg);
  adm.configure({
    concurrency: maxConcurrency(cfg),
    maxDepth: depthBound,
    maxWaitMs: maxWaitMsCfg(cfg),
  });
  const queuedNow = await countQueued(cfg);
  // Pause stops the worker from *running* jobs; enqueue still admits to disk.
  const decision = adm.tryAdmit({
    queued: queuedNow,
    running: worker?.running || 0,
    paused: false,
    maxDepth: depthBound,
  });
  if (!decision.admit) {
    const err = new Error(
      decision.reason === "paused"
        ? "queue paused — not admitting new jobs"
        : `queue full (maxDepth=${maxDepth(cfg)}, queued=${queuedNow})`
    );
    err.code = decision.reason === "paused" ? "QUEUE_PAUSED" : "QUEUE_FULL";
    err.admission = decision.snapshot;
    throw err;
  }

  const dir = await ensureDir(cfg);
  const id = `q_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const nowIso = new Date().toISOString();
  const rec = {
    id,
    goal: item.goal,
    verify: item.verify || [],
    workspace: item.workspace || null,
    maxTurns: item.maxTurns,
    timeoutMs: item.timeoutMs,
    harness: Boolean(item.harness),
    groundHard: item.groundHard,
    claimsRequireEvidence: item.claimsRequireEvidence,
    requireStructuredClaims: item.requireStructuredClaims,
    priority: resolvePriority(item),
    class: item.class || item.priorityClass || "batch",
    status: "queued",
    attempts: 0,
    maxAttempts: item.maxAttempts ?? (item.harness ? 2 : 1),
    createdAt: nowIso,
    enqueuedAt: nowIso,
    maxWaitMs: item.maxWaitMs ?? maxWaitMsCfg(cfg),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
  if (!dir) return rec;
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(rec, null, 2));
  emitQueue({ kind: "enqueued", id, status: "queued", goal: rec.goal?.slice?.(0, 80) });
  kick(cfg);
  return rec;
}

export async function listQueue(cfg, { limit = 50 } = {}) {
  const dir = await ensureDir(cfg);
  if (!dir) return [];
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const items = [];
  for (const f of files) {
    try {
      items.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
    } catch {
      /* skip */
    }
  }
  const now = Date.now();
  items.sort((a, b) => {
    if (a.status === "queued" && b.status !== "queued") return -1;
    if (b.status === "queued" && a.status !== "queued") return 1;
    const pa = a.status === "queued" ? agedPriority(a, now) : (a.priority || 0);
    const pb = b.status === "queued" ? agedPriority(b, now) : (b.priority || 0);
    return pb - pa || String(a.createdAt).localeCompare(String(b.createdAt));
  });
  return items.slice(0, limit);
}

/**
 * How many jobs are queued right now.
 *
 * Admission's finite buffer compares this to maxDepth, so it has to be a count
 * of the queue and not a count of a PAGE of it. It used to be derived from
 * listQueue(cfg, { limit: 500 }), whose limit exists to bound a display: the
 * sort puts queued items first and the slice then caps the count at 500. An
 * operator who raised queue.maxDepth above 500 — a legitimate setting the code
 * accepts — therefore got an admission check that could never refuse, because
 * the number it compared was pinned below the bound. The finite buffer, which
 * is the entire purpose of maxDepth, was silently off.
 *
 * The limit never saved any work either: listQueue reads and parses every
 * record before it slices.
 *
 * @param {object} cfg
 * @returns {Promise<number>}
 */
export async function countQueued(cfg) {
  const items = await listQueue(cfg, { limit: Number.POSITIVE_INFINITY });
  return items.filter((i) => i.status === "queued").length;
}

export async function getQueueItem(cfg, id) {
  const dir = await ensureDir(cfg);
  if (!dir) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function saveItem(cfg, rec) {
  const dir = await ensureDir(cfg);
  if (!dir) return;
  await fs.writeFile(path.join(dir, `${rec.id}.json`), JSON.stringify(rec, null, 2));
}

/**
 * The budget halt is DERIVED from the governor on every kick, never latched.
 *
 * This used to write the governor's verdict into worker.paused — the flag
 * pauseQueue()/resumeQueue() own — which made a hard-cap hit permanent: both
 * documented recovery paths (the control UI's Resume, and the midnight
 * rollover the halt alert promises) reset the governor LEDGER, and nothing
 * anywhere cleared worker.paused, so kick() returned early for the rest of the
 * process's life. One flag was carrying two facts: an operator pause, which
 * must latch until a human lifts it, and a budget halt, which must lift the
 * moment the budget does. They are now separate fields, and only the operator
 * one is sticky.
 *
 * A governor read that throws leaves the previous verdict standing rather than
 * inventing one — loadLedger already swallows its own IO errors, so reaching
 * that catch means something structural, and neither guessing "halted" (a
 * queue stopped by a bad read) nor guessing "clear" (a queue spending past a
 * cap it could not see) is better than the last thing we actually measured.
 *
 * kick() MEASURES; processNext() decides. The gate used to be here as well, and
 * two copies of one predicate in one file is the divergent-duplicate shape — it
 * also put enforcement where work is *scheduled*, which a timer armed a moment
 * earlier simply outruns. Arming a timer that finds the gate shut costs one
 * no-op tick and keeps the decision in exactly one place.
 */
function kick(cfg) {
  if (!worker) worker = { cfg, running: 0, timer: null, paused: false, governorHalt: false };
  worker.cfg = cfg;
  worker.settled = (async () => {
    try {
      const cost = await getCostGovernorStatus(worker.cfg);
      worker.governorHalt = Boolean(cost.paused || cost.hard);
    } catch { /* keep the last measured verdict */ }
    const slots = maxConcurrency(cfg) - (worker.running || 0);
    if (slots <= 0) return;
    worker.timer = setTimeout(() => void processNext(cfg), 50);
    if (worker.timer.unref) worker.timer.unref();
  })();
}

/**
 * Resolves once the most recent kick's governor read has landed.
 *
 * kick() must not block its callers, so its budget check runs detached — which
 * left the decision unobservable from outside: queueStatus() read a verdict
 * that was still in flight, and the only way to wait for it was to guess a
 * number of event-loop ticks. A gate nothing can await is a gate nothing can
 * test, so the in-flight promise is kept and exposed rather than guessed at.
 */
export function queueSettled() {
  return Promise.resolve(worker?.settled);
}

async function processNext(cfg) {
  worker = worker || { cfg, running: 0 };
  // THE gate: the single place that decides whether a job starts. It sits here,
  // where work actually begins, and not in kick(), where work is merely
  // scheduled — a pause or a budget halt landing inside kick's 50ms timer
  // window was otherwise ignored outright. Measured: pauseQueue(), then an
  // enqueue, and the job ran 50ms later anyway on the timer armed before the
  // pause. The verdict read here is the last one kick() measured; re-reading
  // the governor here would make this a second, racing source of truth.
  if (worker.paused || worker.governorHalt) return;
  if ((worker.running || 0) >= maxConcurrency(cfg)) return;
  worker.running = (worker.running || 0) + 1;
  try {
    const items = await listQueue(cfg, { limit: 100 });
    // Prefer higher aged priority
    const queued = items.filter((i) => i.status === "queued");
    queued.sort((a, b) => agedPriority(b) - agedPriority(a));
    const next = queued[0];
    if (!next) return;

    // Deterministic patience (Erlang-A style abandon while queued)
    const adm = getDefaultAdmission(cfg);
    adm.configure({
      concurrency: maxConcurrency(cfg),
      maxDepth: maxDepth(cfg),
      maxWaitMs: next.maxWaitMs ?? maxWaitMsCfg(cfg),
    });
    if (adm.shouldAbandon(next)) {
      next.status = "abandoned";
      next.error = `max queue wait exceeded (${adm.maxWaitMs}ms)`;
      next.finishedAt = new Date().toISOString();
      next.abandonReason = "max_wait";
      await saveItem(cfg, next);
      adm.recordAbandon();
      emitQueue({ kind: "abandoned", id: next.id, status: "abandoned" });
      return;
    }

    next.status = "running";
    next.startedAt = new Date().toISOString();
    await saveItem(cfg, next);

    const key =
      cfg?.agent?.apiKey ||
      process.env.XCLAW_API_KEY ||
      process.env.XAI_API_KEY ||
      process.env.OPENAI_API_KEY;
    if (!key) {
      next.status = "failed";
      next.error = "no API key — set XAI_API_KEY or OPENAI_API_KEY";
      next.finishedAt = new Date().toISOString();
      await saveItem(cfg, next);
      return;
    }

    try {
      next.attempts = (next.attempts || 0) + 1;
      await saveItem(cfg, next);
      const jobOpts = {
        id: next.id.replace(/^q_/, "job_"),
        goal: next.goal,
        cfg,
        workspace: next.workspace || undefined,
        verify: next.verify || [],
        maxTurns: next.maxTurns || cfg.agent?.maxTurns || 12,
        timeoutMs: next.timeoutMs || 180_000,
        autoApprove: true,
        groundHard: next.groundHard,
        claimsRequireEvidence: next.claimsRequireEvidence,
        requireStructuredClaims: next.requireStructuredClaims,
      };
      let job;
      const useHarness =
        next.harness === true ||
        cfg.queue?.useHarness === true ||
        cfg.harness?.queueDefault === true;
      if (useHarness) {
        try {
          const { runLongHarness } = await import("./long-harness.mjs");
          job = await runLongHarness(jobOpts);
        } catch {
          job = await runJob(jobOpts);
        }
      } else {
        job = await runJob(jobOpts);
      }
      await saveJobSummary(job).catch(() => {});
      await recordJob(cfg, job).catch(() => {});
      const admDone = getDefaultAdmission(cfg);
      if (job.pass) {
        next.status = "succeeded";
        next.finishedAt = new Date().toISOString();
        admDone.recordComplete(true);
      } else if ((next.attempts || 1) < (next.maxAttempts || 1)) {
        next.status = "queued"; // retry
        next.error = job.error || "retrying after failure";
        next.finishedAt = null;
      } else {
        next.status = "failed";
        next.finishedAt = new Date().toISOString();
        admDone.recordComplete(false);
      }
      next.result = {
        jobId: job.id,
        pass: job.pass,
        status: job.status,
        turns: job.turns,
        wallMs: job.wallMs,
        textPreview: String(job.text || "").slice(0, 300),
        error: job.error || null,
        attempt: next.attempts,
      };
    } catch (err) {
      next.error = err.message || String(err);
      if ((next.attempts || 1) < (next.maxAttempts || 1)) {
        next.status = "queued";
        next.finishedAt = null;
      } else {
        next.status = "failed";
        next.finishedAt = new Date().toISOString();
      }
    }
    const settled = settleAfterRun(next, await getQueueItem(cfg, next.id));
    if (settled) await saveItem(cfg, settled);
  } finally {
    worker.running = Math.max(0, (worker.running || 1) - 1);
    // chain if more queued and capacity
    const left = (await listQueue(cfg, { limit: 20 })).some((i) => i.status === "queued");
    if (left) kick(cfg);
  }
}

export function queueStatus(cfg) {
  const c = cfg || worker?.cfg || {};
  return {
    concurrency: maxConcurrency(c),
    maxDepth: maxDepth(c),
    maxWaitMs: maxWaitMsCfg(c),
    running: worker?.running || 0,
    // `paused` is the operator's switch; `governorHalt` is the budget's.
    // `blocked` is the only one that answers "will this queue run a job?".
    paused: Boolean(worker?.paused),
    governorHalt: Boolean(worker?.governorHalt),
    blocked: Boolean(worker?.paused || worker?.governorHalt),
  };
}

export function pauseQueue() {
  worker = worker || { cfg: null, running: 0, timer: null, paused: true, governorHalt: false };
  worker.paused = true;
  return queueStatus(worker.cfg);
}

export function resumeQueue(cfg) {
  worker = worker || { cfg, running: 0, timer: null, paused: false, governorHalt: false };
  worker.paused = false;
  worker.cfg = cfg || worker.cfg;
  kick(cfg || worker.cfg);
  return queueStatus(cfg || worker.cfg);
}


/**
 * Decide what a finishing run may write over the record another writer owns.
 *
 * processNext holds the item in memory for the whole job (minutes), so an
 * operator's cancel — or a clearCompletedQueue that unlinks the cancelled
 * record — lands on disk inside that window. Measured live on 3.324.0: a
 * cancel confirmed at t=0.5s was overwritten by the run's final save, which
 * put the item back to "queued" (the retry branch) and ran it AGAIN for
 * another 63s of model time before ending "failed", with the operator's
 * cancellation message gone. A terminal decision belongs to whoever made it.
 *
 * @param {object} next — what the run decided, in memory
 * @param {object|null} onDisk — the record as it stands now (null if removed)
 * @returns {object|null} the record to write, or null to write nothing
 */
export function settleAfterRun(next, onDisk) {
  if (!onDisk) return null; // cleared mid-run: do not resurrect it
  if (onDisk.status !== "cancelled") return next;
  return { ...next, status: "cancelled", error: onDisk.error, finishedAt: onDisk.finishedAt || next.finishedAt };
}

export async function cancelQueueItem(cfg, id) {
  const item = await getQueueItem(cfg, id);
  if (!item) return null;
  if (item.status === "running") {
    item.status = "cancelled";
    item.error = "cancelled while running (best-effort; worker may still finish)";
  } else if (item.status === "queued") {
    item.status = "cancelled";
  } else {
    return item; // already terminal
  }
  item.finishedAt = new Date().toISOString();
  await saveItem(cfg, item);
  return item;
}

export async function queueStats(cfg) {
  // The whole queue, not a page of it: listQueue sorts queued first, so a
  // display-sized limit on a 500+ queued backlog hides every non-queued
  // record — stats saturate, sweeps no-op, and each reports a successful zero.
  const items = await listQueue(cfg, { limit: Number.POSITIVE_INFINITY });
  const by = Object.fromEntries(QUEUE_STATUSES.map((st) => [st, 0]));
  let deadLetter = 0;
  for (const it of items) {
    by[it.status] = (by[it.status] || 0) + 1;
    if (it.status === "failed" && (it.attempts || 0) >= (it.maxAttempts || 1)) {
      deadLetter += 1;
    }
  }
  const adm = getDefaultAdmission(cfg);
  return {
    ...by,
    total: items.length,
    deadLetter,
    worker: queueStatus(cfg),
    admission: adm.snapshot({
      maxDepth: maxDepth(cfg),
      maxWaitMs: maxWaitMsCfg(cfg),
      concurrency: maxConcurrency(cfg),
    }),
  };
}

export async function listDeadLetter(cfg, { limit = 50 } = {}) {
  // The whole queue, not a page of it: listQueue sorts queued first, so a
  // display-sized limit on a 500+ queued backlog hides every non-queued
  // record — stats saturate, sweeps no-op, and each reports a successful zero.
  const items = await listQueue(cfg, { limit: Number.POSITIVE_INFINITY });
  return items
    .filter((it) => it.status === "failed" && (it.attempts || 0) >= (it.maxAttempts || 1))
    .slice(0, limit);
}

export async function retryFailedQueue(cfg) {

  // The whole queue, not a page of it: listQueue sorts queued first, so a
  // display-sized limit on a 500+ queued backlog hides every non-queued
  // record — stats saturate, sweeps no-op, and each reports a successful zero.
  const items = await listQueue(cfg, { limit: Number.POSITIVE_INFINITY });
  let n = 0;
  for (const it of items) {
    if (it.status === "failed") {
      it.status = "queued";
      it.error = null;
      it.finishedAt = null;
      it.attempts = 0;
      await saveItem(cfg, it);
      n += 1;
    }
  }
  if (n) kick(cfg);
  return { requeued: n };
}

export async function clearCompletedQueue(cfg) {
  const dir = await ensureDir(cfg);
  if (!dir) return { removed: 0 };
  // The whole queue, not a page of it: listQueue sorts queued first, so a
  // display-sized limit on a 500+ queued backlog hides every non-queued
  // record — stats saturate, sweeps no-op, and each reports a successful zero.
  const items = await listQueue(cfg, { limit: Number.POSITIVE_INFINITY });
  let removed = 0;
  for (const it of items) {
    if (TERMINAL_QUEUE_STATUSES.includes(it.status)) {
      try {
        await fs.unlink(path.join(dir, `${it.id}.json`));
        removed += 1;
      } catch {
        /* skip */
      }
    }
  }
  return { removed };
}

/** Start background draining (idempotent). */
export function startQueueWorker(cfg) {
  kick(cfg);
  return { ok: true };
}
