-- src/state/control-schema.sql (spec §12.7 starter schema)
--
-- Run inside openControlPlane after the base schema ladder (the ladder's
-- fresh/legacy detection relies on table absence, so the starter cannot
-- run first) and before any §12.8 group DDL. Add CREATE TABLE blocks
-- from §12.1 only when that feature is implemented.
--
-- House shape, deviating from the spec sketch on purpose: TEXT ISO
-- timestamps and no STRICT, matching the live control plane — the
-- spec's STRICT/INTEGER schema_meta would break existing writers on a
-- fresh file. schema_meta.role arrives additively via addColumnIfMissing
-- (§11.14), never by rebuilding the table.
--
-- Bump schema_meta.version only after a successful group migration
-- recorded in migration_runs (§12.9 runNamedMigration writes the rows).

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  touched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  detail TEXT
);
