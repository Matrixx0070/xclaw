/**
 * Single doorway onto Node's builtin SQL engine.
 *
 * Feature code must not import "node:sqlite" directly. This module:
 *   1. confirms the host line is allowed
 *   2. loads the builtin
 *   3. asks the loaded library for sqlite_version()
 *   4. refuses WAL-unsafe libraries
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describeHost, HOST_ENGINE_RANGE } from "../runtime/host-compat.mjs";
import { libClearsWalResetWindow, linkedAgainstSystemSqlite } from "./sql-safety.mjs";

const require = createRequire(import.meta.url);

let loaded = null;

function asErrnoText(err) {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

function refuse(code, text, cause) {
  const err = new Error(text, cause ? { cause } : undefined);
  err.code = code;
  throw err;
}

function confirmLibrary(sqlite) {
  const db = new sqlite.DatabaseSync(":memory:");
  try {
    const row = db.prepare("SELECT sqlite_version() AS version").get();
    const version = typeof row?.version === "string" ? row.version : "";
    if (!libClearsWalResetWindow(version)) {
      const shared = linkedAgainstSystemSqlite();
      const host = process.versions.node;
      const nextStep = shared
        ? "This Node binary links system libsqlite3. Upgrade that library, or switch to an official Node build."
        : `Move this host to ${HOST_ENGINE_RANGE}.`;
      refuse(
        "XCLAW_SQL_UNSAFE",
        `xclaw will not open durable stores on SQLite ${version || "unknown"} (Node ${host}). ` +
          `WAL-reset safe libraries are 3.51.3+, 3.50.7+ on 3.50.x, or 3.44.6+ on 3.44.x. ${nextStep}`
      );
    }
  } finally {
    try { db.close(); } catch { /* probe handle only */ }
  }
}

export function loadBuiltinSql() {
  if (loaded) return loaded;
  const host = describeHost();
  if (!host.allowed) {
    refuse(
      "XCLAW_SQL_UNAVAILABLE",
      `xclaw cannot use the builtin SQL engine on this host. ${host.detail}`
    );
  }
  let sqlite;
  try {
    sqlite = require("node:sqlite");
  } catch (err) {
    refuse(
      "XCLAW_SQL_UNAVAILABLE",
      `xclaw cannot load node:sqlite (${asErrnoText(err)}). Accepted hosts: ${HOST_ENGINE_RANGE}.`,
      err
    );
  }
  if (typeof sqlite?.DatabaseSync !== "function") {
    refuse("XCLAW_SQL_UNAVAILABLE", "node:sqlite loaded without DatabaseSync.");
  }
  confirmLibrary(sqlite);
  loaded = sqlite;
  return loaded;
}

/** Probe the library this process loaded without opening a durable file. */
export function detectLoadedLibVersion() {
  const sqlite = process.getBuiltinModule?.("node:sqlite");
  if (!sqlite?.DatabaseSync) return null;
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    const row = database.prepare("SELECT sqlite_version() AS version").get();
    return typeof row?.version === "string" ? row.version : null;
  } finally {
    try {
      database.close();
    } catch {
      /* probe only */
    }
  }
}

export function toEnginePath(location) {
  if (!location || location === ":memory:" || String(location).startsWith("file:")) {
    return location;
  }
  if (process.platform !== "win32") return location;
  // node:sqlite hands the path to the Windows VFS; keep the long-path prefix.
  return path.toNamespacedPath(path.resolve(location));
}

export function immutableFileUri(filePath) {
  if (process.platform === "win32") {
    const namespaced = path.win32.toNamespacedPath(path.win32.resolve(filePath));
    return `file:${encodeURIComponent(namespaced)}?mode=ro&immutable=1`;
  }
  return `${pathToFileURL(path.resolve(filePath)).href}?mode=ro&immutable=1`;
}

export function openLocalSql(location, options) {
  const sqlite = loadBuiltinSql();
  const target = toEnginePath(location);
  return options === undefined
    ? new sqlite.DatabaseSync(target)
    : new sqlite.DatabaseSync(target, options);
}

export function tryTakeExclusiveLock(location, { waitMs = 0 } = {}) {
  const db = openLocalSql(location);
  const timeout = Math.max(0, Math.trunc(waitMs));
  try {
    db.exec(`PRAGMA busy_timeout = ${timeout}; BEGIN EXCLUSIVE;`);
  } catch (err) {
    try { db.close(); } catch { /* */ }
    const text = asErrnoText(err);
    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(text)) return null;
    throw err;
  }
  return {
    drop() {
      const failures = [];
      try { db.exec("ROLLBACK"); } catch (e) { failures.push(e); }
      try { db.close(); } catch (e) { failures.push(e); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, "xclaw could not drop the SQL coordination lock");
      }
    },
  };
}

export function lexicalIndexAvailable() {
  const sqlite = loadBuiltinSql();
  const db = new sqlite.DatabaseSync(":memory:");
  try {
    db.exec("CREATE VIRTUAL TABLE __xclaw_lex_probe USING fts5(body)");
    return { ready: true };
  } catch (err) {
    return { ready: false, reason: asErrnoText(err) };
  } finally {
    try { db.close(); } catch { /* */ }
  }
}
