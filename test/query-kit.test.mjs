/**
 * openKit is the single-handle doorway later stores sit on.
 * Pins: WAL round-trip, atomic rollback, close actually closes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../src/persist/query-kit.mjs";

describe("query kit", () => {
  it("round-trips a row under WAL through prepare/exec/atomic", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-kit-"));
    const file = path.join(dir, "kit.sqlite");
    const kit = openKit(file, { label: "kit-test" });
    try {
      kit.exec("CREATE TABLE items(id TEXT PRIMARY KEY, n INTEGER)");
      kit.atomic(() => {
        kit.prepare("INSERT INTO items(id, n) VALUES (?, ?)").run("k", 7);
      });
      assert.equal(kit.prepare("SELECT n FROM items WHERE id = ?").get("k").n, 7);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a failed atomic unit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-kit-"));
    const file = path.join(dir, "kit.sqlite");
    const kit = openKit(file, { label: "kit-rollback" });
    try {
      kit.exec("CREATE TABLE items(id TEXT PRIMARY KEY, n INTEGER)");
      kit.prepare("INSERT INTO items(id, n) VALUES (?, ?)").run("keep", 1);
      assert.throws(() => {
        kit.atomic(() => {
          kit.prepare("INSERT INTO items(id, n) VALUES (?, ?)").run("gone", 2);
          throw new Error("boom");
        });
      });
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM items").get().n, 1);
      assert.equal(kit.prepare("SELECT id FROM items").get().id, "keep");
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("close detaches the keeper and closes the handle", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-kit-"));
    const file = path.join(dir, "kit.sqlite");
    const kit = openKit(file);
    kit.exec("CREATE TABLE t(x INTEGER)");
    kit.close();
    assert.equal(kit.db.isOpen, false);
    const again = openKit(file);
    try {
      assert.equal(again.prepare("SELECT COUNT(*) AS n FROM t").get().n, 0);
    } finally {
      again.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
