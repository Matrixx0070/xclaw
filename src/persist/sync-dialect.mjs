/**
 * Sync query-builder dialect (spec §11.9).
 *
 * Optional package later. Must sit on openLocalSql. Do not add a native
 * SQLite addon. Feature code still must not import "node:sqlite".
 * This helper does not bump CONTROL_SCHEMA_VERSION and is not opened
 * from the gateway.
 */
import { openLocalSql } from "./engine-load.mjs";

function isRowQuery(sql) {
  const head = String(sql).trim().slice(0, 6).toUpperCase();
  return head === "SELECT" || head === "PRAGMA" || head.startsWith("WITH");
}

export function createSyncDialect(file) {
  return {
    sqlite: true,
    createDriver() {
      const db = openLocalSql(file);
      return {
        acquire() {
          return {
            db,
            query(sql, params = []) {
              const stmt = db.prepare(sql);
              if (isRowQuery(sql)) {
                return { rows: stmt.all(...params) };
              }
              const info = stmt.run(...params);
              return { rows: [], numAffectedRows: info?.changes ?? 0 };
            },
          };
        },
        release() {},
        destroy() {
          try {
            db.close();
          } catch {
            /* already closed */
          }
        },
      };
    },
  };
}
