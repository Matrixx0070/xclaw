/**
 * Memory search index (spec §11.5 + §11.8).
 *
 * File: ~/.xclaw/memory/main.sqlite — separate from control.sqlite.
 * FTS5 when lexicalIndexAvailable(); search falls back to LIKE.
 * Vector extension is not loaded here (required ticket forbids
 * allowExtension). Not opened from the gateway; recall still reads
 * events.jsonl. Doctor already warns if FTS5 is missing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../persist/query-kit.mjs";
import { lexicalIndexAvailable } from "../persist/engine-load.mjs";
import { isSqlCorruptionError } from "../persist/atomic-work.mjs";
import { quarantineSqlFile } from "../persist/sql-quarantine.mjs";

export function memoryIndexFile(cfg) {
  if (cfg?.paths?.memoryIndexFile) return cfg.paths.memoryIndexFile;
  if (process.env.XCLAW_MEMORY_INDEX_FILE) return process.env.XCLAW_MEMORY_INDEX_FILE;
  const root = cfg?.paths?.memoryDir || path.join(os.homedir(), ".xclaw", "memory");
  return path.join(root, "main.sqlite");
}

function quarantineCorrupt(file, err) {
  if (!isSqlCorruptionError(err)) return;
  try {
    quarantineSqlFile(file);
  } catch {
    /* copy is best-effort; still refuse the open */
  }
}

export function openMemoryIndex(cfg) {
  const file = memoryIndexFile(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let kit;
  try {
    kit = openKit(file, { label: "memory index" });
  } catch (err) {
    quarantineCorrupt(file, err);
    throw err;
  }
  try {
    kit.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'memory',
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embed_cache (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      hash TEXT NOT NULL,
      embedding TEXT NOT NULL,
      dims INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (provider, model, provider_key, hash)
    );
  `);
    const fts = lexicalIndexAvailable();
    if (fts.ready) {
      kit.exec("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, id UNINDEXED, path UNINDEXED)");
    }
    return { kit, fts: fts.ready };
  } catch (err) {
    try {
      kit.close();
    } catch {
      /* still throw */
    }
    quarantineCorrupt(file, err);
    throw err;
  }
}

export function searchMemory(kit, { q, limit = 20 } = {}) {
  const needle = String(q || "").trim();
  if (!needle) return [];
  try {
    return kit.prepare(
      `SELECT chunks.id, chunks.path, chunks.text, rank
       FROM chunks_fts
       JOIN chunks ON chunks.id = chunks_fts.id
       WHERE chunks_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    ).all(needle, limit);
  } catch {
    return kit.prepare(
      `SELECT id, path, text FROM chunks WHERE text LIKE ? LIMIT ?`,
    ).all(`%${needle}%`, limit);
  }
}

export function upsertChunk(kit, row) {
  kit.atomic(() => {
    kit.prepare(
      `INSERT INTO chunks(id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         hash = excluded.hash,
         embedding = excluded.embedding,
         updated_at = excluded.updated_at`,
    ).run(
      row.id,
      row.path,
      row.source || "memory",
      row.start_line || 0,
      row.end_line || 0,
      row.hash,
      row.model || "",
      row.text,
      row.embedding || "[]",
      Date.now(),
    );
    try {
      kit.prepare("DELETE FROM chunks_fts WHERE id = ?").run(row.id);
      kit.prepare("INSERT INTO chunks_fts(id, path, text) VALUES (?, ?, ?)").run(row.id, row.path, row.text);
    } catch { /* FTS5 absent */ }
  });
}
