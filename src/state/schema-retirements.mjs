/**
 * Schema retirement list (spec §12.2).
 *
 * schema-retirements.json names tables/indexes that a past schema bump
 * dropped. On open nothing happens; doctor WARNS when a retired name is
 * still present in sqlite_master, and `doctor --fix` drops a retired
 * TABLE only when it is empty (indexes drop unconditionally). Nothing in
 * doctor --fix may CREATE a retired name — a test guards the lists
 * against the shipping DDL. Ships with empty lists.
 */
import fs from "node:fs";

let cache = null;

export function loadRetirements() {
  if (cache == null) {
    cache = JSON.parse(
      fs.readFileSync(new URL("./schema-retirements.json", import.meta.url), "utf8"),
    );
  }
  return cache;
}

/** Present-in-db retired names for one kind ("control" | "agent"). */
export function listRetiredPresent(db, kind, retirements = loadRetirements()) {
  const spec = retirements?.[kind] || {};
  const tables = new Set(spec.retiredTables || []);
  const indexes = new Set(spec.retiredIndexes || []);
  if (!tables.size && !indexes.size) return [];
  return db
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','index')")
    .all()
    .filter((r) => (r.type === "table" ? tables.has(r.name) : indexes.has(r.name)))
    .map((r) => ({ name: r.name, type: r.type }));
}

/**
 * `doctor --fix` only. Drops retired indexes, and retired tables ONLY
 * when empty — a non-empty retired table is reported, never dropped.
 */
export function dropRetiredIfEmpty(db, kind, retirements = loadRetirements()) {
  const dropped = [];
  const kept = [];
  for (const entry of listRetiredPresent(db, kind, retirements)) {
    if (entry.type === "index") {
      db.exec(`DROP INDEX IF EXISTS "${entry.name.replaceAll('"', '""')}"`);
      dropped.push(entry.name);
      continue;
    }
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${entry.name.replaceAll('"', '""')}"`).get().n;
    if (n === 0) {
      db.exec(`DROP TABLE "${entry.name.replaceAll('"', '""')}"`);
      dropped.push(entry.name);
    } else {
      kept.push(`${entry.name}(${n} rows)`);
    }
  }
  return { dropped, kept };
}
