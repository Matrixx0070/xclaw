/**
 * Durable cron definitions for payload jobs.
 *
 * In-process handlers (doctor / eval / heartbeat) stay owner-registered and
 * are not written here. Payload jobs used to live in ~/.xclaw/cron-jobs.json.
 * That file is imported once, then the ledger is ~/.xclaw/cron/jobs.sqlite.
 *
 * `cronStoreRoot()` honours `paths.configDir` then `XCLAW_CONFIG_DIR` then
 * null. Extra env `XCLAW_CRON_LEDGER_FILE` / `XCLAW_CRON_JOBS_FILE` and
 * `paths.cronLedgerFile` / `paths.cronJobsFile` still win when set. No home
 * fallback. Do not honour `XCLAW_STATE_DIR`. `openCronLedger` still returns
 * null without persisting (do not `mkdir(null)`). Catch is not a substitute.
 */
import fs from "node:fs";
import path from "node:path";
import { openLocalSql } from "../persist/engine-load.mjs";
import { applyStorePragmas } from "../persist/journal-mode.mjs";
import { runAtomic } from "../persist/atomic-work.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payload_jobs (
  id TEXT PRIMARY KEY,
  name TEXT,
  body TEXT NOT NULL,
  touched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payload_jobs_name ON payload_jobs(name);
`;

function cronStoreRoot(cfg) {
  return cfg?.paths?.configDir || process.env.XCLAW_CONFIG_DIR || null;
}

export function cronLedgerFile(cfg) {
  const explicit = cfg?.paths?.cronLedgerFile || process.env.XCLAW_CRON_LEDGER_FILE;
  if (explicit) return explicit;
  const root = cronStoreRoot(cfg);
  return root ? path.join(root, "cron", "jobs.sqlite") : null;
}

export function legacyCronJsonFile(cfg) {
  // Was hard-coded to the home dir while its sibling three lines up honoured
  // configDir: a scoped caller absorbed the OPERATOR'S legacy job file (and
  // renamed it to .bak) instead of its own.
  const explicit = cfg?.paths?.cronJobsFile || process.env.XCLAW_CRON_JOBS_FILE;
  if (explicit) return explicit;
  const root = cronStoreRoot(cfg);
  return root ? path.join(root, "cron-jobs.json") : null;
}

export function openCronLedger(cfg) {
  const file = cronLedgerFile(cfg);
  if (!file) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openLocalSql(file);
  const keeper = applyStorePragmas(db, {
    databasePath: file,
    databaseLabel: "cron ledger",
    busyTimeoutMs: 5000,
    synchronous: "NORMAL",
  });
  db.exec(SCHEMA);

  const writeOne = db.prepare(`
    INSERT INTO payload_jobs(id, name, body, touched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      body = excluded.body,
      touched_at = excluded.touched_at
  `);
  const readAll = db.prepare("SELECT id, name, body, touched_at FROM payload_jobs");
  const dropOne = db.prepare("DELETE FROM payload_jobs WHERE id = ?");

  return {
    file,
    list() {
      return readAll.all().map((row) => {
        const rec = JSON.parse(row.body);
        rec.id = row.id;
        rec.name = rec.name || row.name;
        return rec;
      });
    },
    put(job) {
      writeOne.run(job.id, job.name || "", JSON.stringify(job), new Date().toISOString());
    },
    drop(id) {
      dropOne.run(id);
    },
    replace(jobs) {
      runAtomic(db, () => {
        db.exec("DELETE FROM payload_jobs");
        for (const job of jobs) {
          writeOne.run(job.id, job.name || "", JSON.stringify(job), new Date().toISOString());
        }
      });
    },
    close() {
      keeper.detach();
      db.close();
    },
  };
}

/**
 * Spec §11.6 — fold old cron JSON field names into the current job shape
 * before insert. Returns null when the row still has no id after mapping.
 */
export function normalizeLegacyJob(raw) {
  if (!raw || typeof raw !== "object") return null;
  const job = { ...raw };
  if (!job.id && job.jobId) job.id = job.jobId;
  if (!job.schedule && typeof job.cron === "string") {
    job.schedule = { kind: "cron", expr: job.cron };
  }
  if (job.schedule && typeof job.schedule.cron === "string") {
    job.schedule = { kind: "cron", expr: job.schedule.cron, tz: job.schedule.tz };
  }
  if (!job.schedule && job.intervalMs) {
    job.schedule = { kind: "every", everyMs: job.intervalMs };
  }
  if (job.threadId && !job.delivery) {
    job.delivery = { threadId: job.threadId };
  }
  delete job.jobId;
  delete job.cron;
  delete job.intervalMs;
  delete job.threadId;
  return job.id ? job : null;
}

export function absorbLegacyCronJson(ledger, jsonPath) {
  if (!jsonPath || !fs.existsSync(jsonPath)) return { moved: 0 };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return { moved: 0, error: "unreadable_json" };
  }
  const rows = Array.isArray(parsed?.jobs) ? parsed.jobs : Array.isArray(parsed) ? parsed : [];
  let moved = 0;
  for (const raw of rows) {
    const job = normalizeLegacyJob(raw);
    if (!job) continue;
    ledger.put(job);
    moved += 1;
  }
  if (moved > 0) {
    try { fs.renameSync(jsonPath, `${jsonPath}.bak`); } catch { /* keep original if rename denied */ }
  }
  return { moved };
}
