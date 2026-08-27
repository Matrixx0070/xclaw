/**
 * Memory vector extension loader (spec §12.4).
 *
 * Loads sqlite-vec ONLY on a handle opened with `{ allowExtension: true }`
 * — the default everywhere stays no-extensions, and a handle without the
 * option refuses (`enableLoadExtension` throws → { ready: false }).
 * Candidates: $XCLAW_SQLITE_VEC, then the bundled native/sqlite-vec path.
 *
 * Deviation from the spec sketch, verified live: node:sqlite authorizes
 * only the `db.loadExtension(file)` METHOD — the SQL loader function
 * stays "not authorized" even after enableLoadExtension(true) — so the
 * loader uses the method. Success is still proven by
 * `SELECT vec_version()`. Chunks keep storing embedding JSON in
 * chunks.embedding regardless.
 */

export function tryLoadVec(db) {
  const candidates = [
    process.env.XCLAW_SQLITE_VEC,
    new URL("../../native/sqlite-vec", import.meta.url).pathname,
  ].filter(Boolean);
  try {
    db.enableLoadExtension(true);
  } catch {
    // handle was opened without { allowExtension: true } — hard no,
    // reported distinctly so callers can tell "forbidden" from "no
    // candidate loaded".
    return { ready: false, refused: true };
  }
  try {
    for (const file of candidates) {
      try {
        db.loadExtension(String(file));
        db.exec("SELECT vec_version()");
        return { ready: true, file };
      } catch {
        /* try next candidate */
      }
    }
    return { ready: false };
  } finally {
    try {
      db.enableLoadExtension(false);
    } catch {
      /* leave as-is */
    }
  }
}
