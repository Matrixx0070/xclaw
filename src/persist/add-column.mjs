/**
 * Additive columns only (spec §11.14).
 *
 * New fields are ALTER TABLE … ADD COLUMN. Never rebuild a populated
 * table in place. Callers stamp schema_meta in the same runAtomic as
 * the add. This helper does not bump CONTROL_SCHEMA_VERSION.
 */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(kind, value) {
  if (typeof value !== "string" || !IDENT.test(value)) {
    throw new Error(`invalid ${kind} identifier`);
  }
  return value;
}

export function addColumnIfMissing(db, table, column, decl) {
  const t = ident("table", table);
  const c = ident("column", column);
  if (typeof decl !== "string" || !decl.trim() || /[;\n]/.test(decl)) {
    throw new Error("invalid column declaration");
  }
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((row) => row.name);
  if (cols.includes(c)) return false;
  db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${decl}`);
  return true;
}
