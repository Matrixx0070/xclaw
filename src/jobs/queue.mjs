/**
 * Multi-job queue — bounded concurrency with admission control (X1).
 * Jobs are persisted under ~/.xclaw/job-queue/
 *
 * cfg.queue: concurrency, maxDepth, maxWaitMs, maxConcurrencyCap
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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

function queueDir(cfg) {
  const base = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return path.join(base, "job-queue");
}

async function ensureDir(cfg) {
  const dir = queueDir(cfg);
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
export async function enqueueJob(cfg, item) {
  if (!item?.goal) throw new Error("goal required");

  // Admission: finite buffer (maxDepth) + pause
  const adm = getDefaultAdmission(cfg);
  adm.configure({
    concurrency: maxConcurrency(cfg),
    maxDepth: maxDepth(cfg),
    maxWaitMs: maxWaitMsCfg(cfg),
  });
  const queuedNow = (await listQueue(cfg, { limit: 500 })).filter((i) => i.status === "queued").length;
  // Pause stops the worker from *running* jobs; enqueue still admits to disk.
  const decision = adm.tryAdmit({
    queued: queuedNow,
    running: worker?.running || 0,
    paused: false,
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
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(rec, null, 2));
  emitQueue({ kind: "enqueued", id, status: "queued", goal: rec.goal?.slice?.(0, 80) });
  kick(cfg);
  return rec;
}

export async function listQueue(cfg, { limit = 50 } = {}) {
  const dir = await ensureDir(cfg);
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

export async function getQueueItem(cfg, id) {
  const dir = await ensureDir(cfg);
  try {
    return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

async function saveItem(cfg, rec) {
  const dir = await ensureDir(cfg);
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
    await saveItem(cfg, next);
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
  const items = await listQueue(cfg, { limit: 500 });
  const by = { queued: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0 };
  let deadLetter = 0;
  for (const it of items) {
    by[it.status] = (by[it.status] || 0) + 1;
    if (it.status === "failed" && (it.attempts || 0) >= (it.maxAttempts || 1)) {
      deadLetter += 1;
    }
  }
  const abandoned = items.filter((i) => i.status === "abandoned").length;
  by.abandoned = abandoned;
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
  const items = await listQueue(cfg, { limit: 500 });
  return items
    .filter((it) => it.status === "failed" && (it.attempts || 0) >= (it.maxAttempts || 1))
    .slice(0, limit);
}

export async function retryFailedQueue(cfg) {

  const items = await listQueue(cfg, { limit: 500 });
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
  const items = await listQueue(cfg, { limit: 500 });
  let removed = 0;
  for (const it of items) {
    if (["succeeded", "failed", "cancelled"].includes(it.status)) {
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
