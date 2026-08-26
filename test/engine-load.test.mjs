import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBuiltinSql, openLocalSql } from "../src/persist/engine-load.mjs";
import { applyStorePragmas } from "../src/persist/journal-mode.mjs";
import { runAtomic } from "../src/persist/atomic-work.mjs";

describe("builtin engine", () => {
  it("loads DatabaseSync on a supported host", () => {
    const sql = loadBuiltinSql();
    assert.equal(typeof sql.DatabaseSync, "function");
  });

  it("round-trips a row under WAL", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-sql-"));
    const file = path.join(dir, "probe.sqlite");
    const db = openLocalSql(file);
    let keeper;
    try {
      keeper = applyStorePragmas(db, { databasePath: file, busyTimeoutMs: 1000, synchronous: "NORMAL" });
      db.exec("CREATE TABLE items(id TEXT PRIMARY KEY, n INTEGER)");
      runAtomic(db, () => {
        db.prepare("INSERT INTO items(id, n) VALUES (?, ?)").run("k", 7);
      });
      assert.equal(db.prepare("SELECT n FROM items WHERE id = ?").get("k").n, 7);
      keeper.checkpoint();
    } finally {
      try { keeper?.detach(); } catch { /* */ }
      try { db.close(); } catch { /* */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
