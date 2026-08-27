/**
 * Additive columns (spec §11.14).
 * Pins: add missing, skip when present (do not rebuild), keep rows,
 * refuse junk identifiers. Does not bump control schema.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addColumnIfMissing } from "../src/persist/add-column.mjs";
import { openKit } from "../src/persist/query-kit.mjs";

function tmpKit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-addcol-"));
  const file = path.join(dir, "t.sqlite");
  const kit = openKit(file, { label: "add-column" });
  return { dir, kit };
}

describe("addColumnIfMissing", () => {
  it("adds a missing column and returns true", () => {
    const { dir, kit } = tmpKit();
    try {
      kit.exec("CREATE TABLE devices(id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
      kit.prepare("INSERT INTO devices(id, payload) VALUES (?, ?)").run("d1", "{}");
      const added = addColumnIfMissing(kit.db, "devices", "last_seen", "TEXT");
      assert.equal(added, true);
      const cols = kit
        .prepare("PRAGMA table_info(devices)")
        .all()
        .map((r) => r.name);
      assert.deepEqual(cols, ["id", "payload", "last_seen"]);
      const row = kit.prepare("SELECT id, payload, last_seen FROM devices").get();
      assert.equal(row.id, "d1");
      assert.equal(row.payload, "{}");
      assert.equal(row.last_seen, null);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips an existing column, keeps rows, and does not rebuild", () => {
    const { dir, kit } = tmpKit();
    try {
      kit.exec(
        "CREATE TABLE devices(id TEXT PRIMARY KEY, payload TEXT NOT NULL, last_seen TEXT)",
      );
      kit
        .prepare("INSERT INTO devices(id, payload, last_seen) VALUES (?, ?, ?)")
        .run("d1", "{}", "2026-08-27T00:00:00.000Z");
      const added = addColumnIfMissing(kit.db, "devices", "last_seen", "TEXT");
      assert.equal(added, false);
      const cols = kit
        .prepare("PRAGMA table_info(devices)")
        .all()
        .map((r) => r.name);
      assert.deepEqual(cols, ["id", "payload", "last_seen"]);
      const row = kit.prepare("SELECT id, payload, last_seen FROM devices").get();
      assert.equal(row.id, "d1");
      assert.equal(row.payload, "{}");
      assert.equal(row.last_seen, "2026-08-27T00:00:00.000Z");
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 1);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("second add of the same column is a no-op", () => {
    const { dir, kit } = tmpKit();
    try {
      kit.exec("CREATE TABLE devices(id TEXT PRIMARY KEY)");
      assert.equal(addColumnIfMissing(kit.db, "devices", "last_seen", "TEXT"), true);
      assert.equal(addColumnIfMissing(kit.db, "devices", "last_seen", "TEXT"), false);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a junk table identifier and does not exec it", () => {
    const { dir, kit } = tmpKit();
    try {
      kit.exec("CREATE TABLE devices(id TEXT PRIMARY KEY)");
      assert.throws(
        () => addColumnIfMissing(kit.db, "devices;DROP TABLE devices", "last_seen", "TEXT"),
        /invalid table/,
      );
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM devices").get().n, 0);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
