/**
 * Probe a Node binary that may not be process.execPath
 * (systemd unit, nvm shim, leftover older install).
 * Used by doctor and daemon start.
 */
import { execFile } from "node:child_process";
import { describeHost, HOST_ENGINE_RANGE, hostPasses } from "./host-compat.mjs";
import { libClearsWalResetWindow } from "../persist/sql-safety.mjs";

const PROBE_JS = `
  const sqlite = process.getBuiltinModule && process.getBuiltinModule("node:sqlite");
  let sqliteVersion = null;
  if (sqlite && sqlite.DatabaseSync) {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      const row = db.prepare("SELECT sqlite_version() AS version").get();
      sqliteVersion = row && row.version ? row.version : null;
    } finally { db.close(); }
  }
  const vars = (process.config && process.config.variables) || {};
  const shared = vars.node_shared_sqlite === true || vars.node_shared_sqlite === "true";
  process.stdout.write(JSON.stringify({
    nodeVersion: process.versions.node,
    execPath: process.execPath,
    sqliteVersion,
    sharedSqlite: shared
  }));
`;

function execJson(bin) {
  return new Promise((resolve) => {
    execFile(bin, ["-e", PROBE_JS], { timeout: 8000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, error: err.message, bin });
        return;
      }
      try { resolve({ ok: true, bin, ...JSON.parse(String(stdout)) }); }
      catch (e) { resolve({ ok: false, error: e.message, bin }); }
    });
  });
}

export async function inspectNodeBinary(bin = process.execPath) {
  const raw = await execJson(bin);
  if (!raw.ok) {
    return {
      ok: false,
      bin,
      detail: `Could not probe ${bin}: ${raw.error}`,
    };
  }
  const host = describeHost(raw.nodeVersion);
  const sqlOk = raw.sqliteVersion ? libClearsWalResetWindow(raw.sqliteVersion) : false;
  const ok = host.allowed && sqlOk;
  let detail;
  if (!host.allowed) detail = host.detail;
  else if (!raw.sqliteVersion) detail = `Node ${raw.nodeVersion} has no usable node:sqlite.`;
  else if (!sqlOk && raw.sharedSqlite) {
    detail = `Node ${raw.nodeVersion} at ${raw.execPath} links system SQLite ${raw.sqliteVersion}, which is not WAL-reset safe.`;
  } else if (!sqlOk) {
    detail = `Node ${raw.nodeVersion} embeds SQLite ${raw.sqliteVersion}, which is not WAL-reset safe. Use ${HOST_ENGINE_RANGE}.`;
  } else {
    detail = `Node v${host.raw} (${host.band}), SQLite ${raw.sqliteVersion}`;
  }
  return {
    ok,
    bin,
    execPath: raw.execPath,
    nodeVersion: raw.nodeVersion,
    sqliteVersion: raw.sqliteVersion,
    sharedSqlite: raw.sharedSqlite,
    host,
    detail,
    pathEnv: process.env.PATH || "(not set)",
  };
}

export function formatHostRefusal(info) {
  return [
    `xclaw needs Node ${HOST_ENGINE_RANGE} with a WAL-safe bundled SQLite.`,
    `Detected: node ${info.nodeVersion || "unknown"} (exec: ${info.execPath || info.bin || "unknown"}).`,
    `PATH searched: ${info.pathEnv || process.env.PATH || "(not set)"}`,
    info.detail,
    "Install from https://nodejs.org then re-run xclaw.",
    "nvm: nvm install 24.15 && nvm use 24.15",
  ].join("\n");
}

export { hostPasses, HOST_ENGINE_RANGE };
