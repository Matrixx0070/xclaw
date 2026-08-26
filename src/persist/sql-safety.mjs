/**
 * Decide whether the SQLite library this process actually loaded
 * is past the WAL-reset corruption window.
 *
 * Safe:
 *   3.51.3 and newer
 *   3.50.x from 3.50.7
 *   3.44.x from 3.44.6
 *
 * Query sqlite_version() from an in-memory handle. Distro Node builds
 * can link system libsqlite3, so process.versions.node is not enough.
 */

const FIXED = { major: 3, minor: 51, patch: 3 };
const LINE_FIXES = [
  { major: 3, minor: 50, patch: 7 },
  { major: 3, minor: 44, patch: 6 },
];

const VER_RE = /^(\d+)\.(\d+)\.(\d+)/;

export function parseLibVersion(text) {
  const hit = VER_RE.exec(String(text || "").trim());
  if (!hit) return null;
  return {
    major: Number(hit[1]),
    minor: Number(hit[2]),
    patch: Number(hit[3]),
  };
}

function aheadOrEqual(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function libClearsWalResetWindow(text) {
  const v = parseLibVersion(text);
  if (!v) return false;
  if (aheadOrEqual(v, FIXED) >= 0) return true;
  return LINE_FIXES.some(
    (fix) => v.major === fix.major && v.minor === fix.minor && v.patch >= fix.patch
  );
}

export function linkedAgainstSystemSqlite() {
  const vars = process.config?.variables || {};
  return vars.node_shared_sqlite === true || vars.node_shared_sqlite === "true";
}

// detectLoadedLibVersion() lives in engine-load.mjs — the single in-process
// doorway that loads the builtin SQL module (acceptance §8.2 keeps the module
// specifier string out of every file except that doorway and host-probe.mjs).
