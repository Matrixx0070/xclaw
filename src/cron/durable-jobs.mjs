/**
 * Durable cron definitions for payload jobs.
 *
 * In-process handlers (doctor / eval / heartbeat) stay owner-registered and
 * are not written here. Payload jobs used to live in ~/.xclaw/cron-jobs.json.
 * That file is imported once, then the ledger is ~/.xclaw/cron/jobs.sqlite.
 */
import fs from "node:fs";
import os from "node:os";
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

export function cronLedgerFile(cfg) {
  const root = cfg?.paths?.configDir || path.join(os.homedir(), ".xclaw");
  return (
    cfg?.paths?.cronLedgerFile ||
    process.env.XCLAW_CRON_LEDGER_FILE ||
    path.join(root, "cron", "jobs.sqlite")
  );
}

export function legacyCronJsonFile(cfg) {
  return (
    cfg?.paths?.cronJobsFile ||
    process.env.XCLAW_CRON_JOBS_FILE ||
    path.join(os.homedir(), ".xclaw", "cron-jobs.json")
  );
}

export function openCronLedger(cfg) {
  const file = cronLedgerFile(cfg);
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
  for (const job of rows) {
    if (!job?.id) continue;
    ledger.put(job);
    moved += 1;
  }
  if (moved > 0) {
    try { fs.renameSync(jsonPath, `${jsonPath}.bak`); } catch { /* keep original if rename denied */ }
  }
  return { moved };
}
