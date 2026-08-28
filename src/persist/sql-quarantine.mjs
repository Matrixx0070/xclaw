/**
 * Spec §11.18 corruption recovery + §11.17 doctor probes.
 *
 * If isSqlCorruptionError fires on control or memory: copy file / -wal / -shm
 * to file.corrupt.<stamp>, stop writes, do not loop reopen, do not delete
 * the original. Doctor reports the path; the operator restores or starts empty.
 * A lock (gateway holds the file) is busy, not corruption.
 */
import fs from "node:fs";
import { openLocalSql } from "./engine-load.mjs";
import { isSqlCorruptionError, isSqlLockError } from "./atomic-work.mjs";

/** The 16-byte header every SQLite database file starts with. */
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");
const SQLITE_NOTADB = 26;

/**
 * An error if `file` cannot be a SQLite database, else null.
 *
 * A missing or zero-length file is NOT an error: SQLite creates the one and
 * treats the other as a brand-new empty database, and so do we.
 */
export function notADatabaseError(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null; // missing (or unreadable — let the real open report that)
  }
  try {
    const head = Buffer.alloc(SQLITE_MAGIC.length);
    const read = fs.readSync(fd, head, 0, head.length, 0);
    if (read === 0) return null; // empty file — a valid new database
    if (read === head.length && head.equals(SQLITE_MAGIC)) return null;
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* header peek only */
    }
  }
  const err = new Error(`file is not a database (${file})`);
  err.code = "ERR_SQLITE_ERROR";
  err.errcode = SQLITE_NOTADB; // classifies as corruption for quarantine
  return err;
}

/**
 * Quarantine and refuse BEFORE handing a non-database file to SQLite.
 *
 * SQLite's own failed open can unlink the file's -wal and -shm: a corrupt
 * main file plus a hot WAL went in, and one file came out, so quarantine had
 * nothing left to copy and the committed-but-uncheckpointed transactions in
 * that WAL — the most recoverable data there is — were gone. It is not
 * reliable enough to test for directly either: 1 run in 300 lost them here,
 * and only under CPU load (found as a CI-only failure of the §11.18 test).
 * Peeking at the 16-byte header first keeps the sidecars intact, and makes
 * the refusal deterministic rather than a race with SQLite's cleanup.
 */
export function refuseNotADatabase(file) {
  const err = notADatabaseError(file);
  if (!err) return;
  try {
    quarantineSqlFile(file);
  } catch {
    /* copy is best-effort; still refuse the open */
  }
  throw err;
}

export function quarantineSqlFile(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const copies = [];
  for (const side of ["", "-wal", "-shm"]) {
    const src = `${file}${side}`;
    if (!fs.existsSync(src)) continue;
    const dest = `${file}.corrupt.${stamp}${side}`;
    fs.copyFileSync(src, dest);
    copies.push(dest);
  }
  return { stamp, dest: `${file}.corrupt.${stamp}`, copies };
}

export function classifySqlProbe(err, file) {
  if (isSqlLockError(err)) {
    return { status: "warn", message: `busy (gateway may hold ${file})` };
  }
  if (isSqlCorruptionError(err)) {
    return { status: "error", message: `${file} corrupt: ${err.message || "SQLITE_CORRUPT"}` };
  }
  return { status: "error", message: err?.message || String(err) };
}

export function probeSqlFile(push, id, file) {
  if (!fs.existsSync(file)) {
    push(id, "info", "not created yet");
    return;
  }
  let db;
  try {
    db = openLocalSql(file);
    const row = db.prepare("PRAGMA integrity_check").get();
    const ok = String(row?.integrity_check || "").toLowerCase() === "ok";
    push(id, ok ? "ok" : "error", ok ? file : String(row?.integrity_check));
  } catch (err) {
    const { status, message } = classifySqlProbe(err, file);
    push(id, status, message);
  } finally {
    try {
      db?.close();
    } catch {
      /* probe handle only */
    }
  }
}
