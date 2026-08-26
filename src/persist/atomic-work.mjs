/**
 * Nested units of work on a DatabaseSync handle.
 * Outer unit: BEGIN IMMEDIATE / COMMIT / ROLLBACK.
 * Inner unit: SAVEPOINT / RELEASE / ROLLBACK TO.
 *
 * Also: lock vs corruption classification, slow-step warnings,
 * reject Promise-returning work, close the handle if ROLLBACK fails.
 */
const nest = new WeakMap();
let savepointSeq = 0;

const LOCK_CODES = new Set(["SQLITE_BUSY", "SQLITE_LOCKED"]);
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;
const PRIMARY_MASK = 0xff;
const SLOW_BUSY_MS = 1_000;
const SLOW_HOLD_MS = 1_000;

function currentDepth(db) {
  return nest.get(db) || 0;
}

function setDepth(db, n) {
  if (n <= 0) nest.delete(db);
  else nest.set(db, n);
}

function errorCode(err) {
  const code = err && typeof err === "object" ? err.code : undefined;
  return typeof code === "string" ? code : undefined;
}

function extendedCode(err) {
  const errcode = err && typeof err === "object" ? err.errcode : undefined;
  return typeof errcode === "number" && Number.isInteger(errcode) ? errcode : undefined;
}

function primaryCode(err) {
  const ext = extendedCode(err);
  return ext === undefined ? undefined : ext & PRIMARY_MASK;
}

function isThenable(value) {
  return Boolean(value) && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}

function assertSyncResult(value) {
  if (isThenable(value)) {
    throw new Error("SQL units of work must be synchronous; Promise returns are not supported.");
  }
}

export function isSqlLockError(err) {
  const code = errorCode(err);
  if (code && LOCK_CODES.has(code)) return true;
  const primary = primaryCode(err);
  if (primary === SQLITE_BUSY || primary === SQLITE_LOCKED) return true;
  const text = String(err?.message || err || "");
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(text);
}

export function isSqlCorruptionError(err) {
  const primary = primaryCode(err);
  return primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB;
}

function warn(msg, extra) {
  try {
    console.warn(`[xclaw:sql] ${msg}`, extra || "");
  } catch {
    /* */
  }
}

function timedExec(db, sql, step, opts = {}) {
  const started = Date.now();
  try {
    db.exec(sql);
    const elapsedMs = Date.now() - started;
    const threshold = opts.busyTimeoutMs > 0 ? Math.min(SLOW_BUSY_MS, opts.busyTimeoutMs) : SLOW_BUSY_MS;
    if (elapsedMs >= threshold) {
      warn("slow SQL lock wait", {
        step,
        elapsedMs,
        thresholdMs: threshold,
        pid: process.pid,
        label: opts.databaseLabel,
      });
    }
    return elapsedMs;
  } catch (err) {
    const elapsedMs = Date.now() - started;
    if (isSqlLockError(err)) {
      warn("SQL lock wait failed", {
        step,
        elapsedMs,
        code: errorCode(err),
        sqliteErrcode: extendedCode(err),
        sqlitePrimaryCode: primaryCode(err),
        pid: process.pid,
        label: opts.databaseLabel,
      });
    }
    throw err;
  }
}

function abortOuter(db) {
  try {
    db.exec("ROLLBACK");
  } catch {
    try {
      if (typeof db.close === "function") db.close();
    } catch {
      /* keep the original unit-of-work error */
    }
  }
}

function nextSavepoint() {
  savepointSeq += 1;
  return `xclaw_sp_${savepointSeq}`;
}

export function runAtomic(db, work, opts = {}) {
  const depth = currentDepth(db);
  if (depth > 0) {
    const tag = nextSavepoint();
    db.exec(`SAVEPOINT ${tag}`);
    setDepth(db, depth + 1);
    try {
      const value = work();
      assertSyncResult(value);
      db.exec(`RELEASE SAVEPOINT ${tag}`);
      return value;
    } catch (err) {
      try {
        db.exec(`ROLLBACK TO SAVEPOINT ${tag}`);
      } finally {
        try {
          db.exec(`RELEASE SAVEPOINT ${tag}`);
        } catch {
          /* */
        }
      }
      throw err;
    } finally {
      setDepth(db, depth);
    }
  }

  timedExec(db, opts.mode === "deferred" ? "BEGIN" : "BEGIN IMMEDIATE", "begin", opts);
  setDepth(db, 1);
  const started = Date.now();
  let stillOpen = true;
  let value;
  try {
    value = work();
    assertSyncResult(value);
  } catch (err) {
    try {
      abortOuter(db);
      stillOpen = false;
    } catch {
      /* */
    }
    setDepth(db, 0);
    throw err;
  }

  const holdMs = Date.now() - started;
  const holdLimit = opts.slowTransactionHoldMs ?? SLOW_HOLD_MS;
  if (holdMs >= holdLimit) {
    warn("slow SQL unit hold", {
      elapsedMs: holdMs,
      thresholdMs: holdLimit,
      pid: process.pid,
      label: opts.databaseLabel,
    });
  }

  try {
    timedExec(db, "COMMIT", "commit", opts);
    stillOpen = false;
    return value;
  } catch (err) {
    try {
      abortOuter(db);
      stillOpen = false;
    } catch {
      /* */
    }
    throw err;
  } finally {
    if (!stillOpen) setDepth(db, 0);
  }
}

export function runDeferred(db, work, opts = {}) {
  return runAtomic(db, work, { ...opts, mode: "deferred" });
}
