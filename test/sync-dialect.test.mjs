/**
 * Sync query-builder dialect (spec §11.9).
 * Pins: sits on openLocalSql (no node:sqlite import), SELECT/PRAGMA/WITH
 * return rows, INSERT returns numAffectedRows, release does not close,
 * destroy does. Does not bump control schema.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSyncDialect } from "../src/persist/sync-dialect.mjs";

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-dialect-"));
  return { dir, file: path.join(dir, "t.sqlite") };
}

describe("createSyncDialect", () => {
  it("round-trips SELECT rows through acquire().query", () => {
    const { dir, file } = tmpFile();
    const driver = createSyncDialect(file).createDriver();
    try {
      const conn = driver.acquire();
      conn.query("CREATE TABLE items(id TEXT PRIMARY KEY, n INTEGER)");
      const inserted = conn.query("INSERT INTO items(id, n) VALUES (?, ?)", ["k", 7]);
      assert.deepEqual(inserted.rows, []);
      assert.equal(inserted.numAffectedRows, 1);
      const got = conn.query("SELECT n FROM items WHERE id = ?", ["k"]);
      assert.equal(got.rows.length, 1);
      assert.equal(got.rows[0].n, 7);
    } finally {
      driver.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("PRAGMA and WITH return rows, not the run path", () => {
    const { dir, file } = tmpFile();
    const driver = createSyncDialect(file).createDriver();
    try {
      const conn = driver.acquire();
      conn.query("CREATE TABLE items(id TEXT PRIMARY KEY)");
      const pragma = conn.query("PRAGMA table_info(items)");
      assert.ok(Array.isArray(pragma.rows));
      assert.equal(pragma.rows.some((r) => r.name === "id"), true);
      assert.equal(pragma.numAffectedRows, undefined);
      const withRows = conn.query("WITH x AS (SELECT 1 AS n) SELECT n FROM x");
      assert.equal(withRows.rows.length, 1);
      assert.equal(withRows.rows[0].n, 1);
      assert.equal(withRows.numAffectedRows, undefined);
    } finally {
      driver.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("release does not close; destroy does", () => {
    const { dir, file } = tmpFile();
    const driver = createSyncDialect(file).createDriver();
    try {
      const conn = driver.acquire();
      conn.query("CREATE TABLE t(x INTEGER)");
      driver.release();
      assert.equal(conn.db.isOpen, true);
      const again = driver.acquire();
      assert.equal(again.query("SELECT COUNT(*) AS n FROM t").rows[0].n, 0);
      driver.destroy();
      assert.equal(conn.db.isOpen, false);
      assert.throws(() => again.query("SELECT 1 AS n"));
    } finally {
      try {
        driver.destroy();
      } catch {
        /* already closed */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("source sits on openLocalSql and does not import node:sqlite", () => {
    const src = fs.readFileSync(
      new URL("../src/persist/sync-dialect.mjs", import.meta.url),
      "utf8",
    );
    assert.equal(/from ["']node:sqlite["']/.test(src), false);
    assert.equal(/require\(["']node:sqlite["']\)/.test(src), false);
    assert.equal(src.includes("openLocalSql"), true);
    assert.equal(src.includes("createSyncDialect"), true);
  });
});
