/**
 * Audit migration runner (spec §12.9).
 *
 * Every named migration leaves a permanent row in migration_runs — ok or
 * error. Never delete migration_runs rows (no delete helper exists).
 * Self-contained: both helpers ensure the table on the kit they are
 * given, so this works on the control-plane kit or a per-agent kit
 * without touching openControlPlane (§12.7 starter schema is separate).
 *
 * Deviations from the spec sketch, both documented:
 * - timestamps are TEXT ISO (house style; spec uses INTEGER ms, STRICT);
 * - the ok row is recorded INSIDE the same kit.atomic as the migration
 *   body, so a migration and its audit row commit together (the spec
 *   records after the atomic, which can apply a migration unrecorded on
 *   a crash between the two).
 */

const DDL = `
CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  detail TEXT
);
`;

export function ensureMigrationRuns(kit) {
  kit.exec(DDL);
}

export function listMigrationHistory(kit) {
  ensureMigrationRuns(kit);
  return kit
    .prepare(
      "SELECT id, name, started_at, finished_at, status, detail FROM migration_runs ORDER BY started_at",
    )
    .all();
}

export function runNamedMigration(kit, name, fn) {
  ensureMigrationRuns(kit);
  const id = `mig_${name}_${Date.now()}`;
  const started = new Date().toISOString();
  try {
    kit.atomic(() => {
      fn(kit);
      kit
        .prepare(
          "INSERT INTO migration_runs(id, name, started_at, finished_at, status, detail) VALUES (?, ?, ?, ?, 'ok', '')",
        )
        .run(id, name, started, new Date().toISOString());
    });
    return id;
  } catch (err) {
    try {
      kit
        .prepare(
          "INSERT INTO migration_runs(id, name, started_at, finished_at, status, detail) VALUES (?, ?, ?, ?, 'error', ?)",
        )
        .run(id, name, started, new Date().toISOString(), String(err?.message || err));
    } catch {
      /* audit row is best-effort on failure; still rethrow the migration error */
    }
    throw err;
  }
}
