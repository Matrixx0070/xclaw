/**
 * One-handle SQL kit later stores sit on.
 * Same doorway as the cron ledger: openLocalSql + applyStorePragmas + runAtomic.
 * Do not open a second driver from here.
 */
import { openLocalSql } from "./engine-load.mjs";
import { applyStorePragmas } from "./journal-mode.mjs";
import { runAtomic } from "./atomic-work.mjs";

export function openKit(file, opts = {}) {
  const db = openLocalSql(file);
  const keeper = applyStorePragmas(db, {
    databasePath: file,
    databaseLabel: opts.label || "kit",
    busyTimeoutMs: opts.busyTimeoutMs ?? 5000,
    synchronous: "NORMAL",
  });
  return {
    db,
    keeper,
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    atomic: (fn) => runAtomic(db, fn, { databaseLabel: opts.label }),
    close() {
      keeper.detach();
      db.close();
    },
  };
}
