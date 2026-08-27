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
