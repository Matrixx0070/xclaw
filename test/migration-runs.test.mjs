/**
 * Audit migration runner (spec §12.9) — a migration and its ok row commit
 * in one atomic; a failing migration rolls back its changes and leaves a
 * permanent error row; history is ordered; rows are never deleted (no
 * delete helper, no DELETE statement in the module).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../src/persist/query-kit.mjs";
import {
  ensureMigrationRuns,
  listMigrationHistory,
  runNamedMigration,
} from "../src/persist/migration-runs.mjs";

function tmpKit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-mig-"));
  const kit = openKit(path.join(dir, "t.sqlite"), { label: "migration test" });
  return { dir, kit };
}

describe("migration runner (spec §12.9)", () => {
  it("ok migration applies fn and records an ok row in the same atomic", () => {
    const { dir, kit } = tmpKit();
    try {
      const id = runNamedMigration(kit, "add-scratch", (k) => {
        k.exec("CREATE TABLE scratch (v TEXT)");
        k.prepare("INSERT INTO scratch(v) VALUES ('x')").run();
      });
      assert.match(id, /^mig_add-scratch_\d+$/);
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM scratch").get().n, 1);
      const rows = listMigrationHistory(kit);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, id);
      assert.equal(rows[0].name, "add-scratch");
      assert.equal(rows[0].status, "ok");
      assert.ok(rows[0].started_at <= rows[0].finished_at);
      const src = fs.readFileSync(
        new URL("../src/persist/migration-runs.mjs", import.meta.url),
        "utf8",
      );
      const runFn = src.slice(src.indexOf("export function runNamedMigration"));
      const atomicBody = runFn.slice(runFn.indexOf("kit.atomic(() => {"), runFn.indexOf("return id;"));
      assert.match(atomicBody, /fn\(kit\)/);
      assert.match(atomicBody, /'ok'/);
      assert.doesNotMatch(src, /DELETE FROM migration_runs/);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("failing migration rolls back its changes, records a permanent error row, rethrows", () => {
    const { dir, kit } = tmpKit();
    try {
      kit.exec("CREATE TABLE seed (v TEXT)");
      assert.throws(
        () =>
          runNamedMigration(kit, "bad", (k) => {
            k.prepare("INSERT INTO seed(v) VALUES ('should-roll-back')").run();
            throw new Error("boom mid-migration");
          }),
        /boom mid-migration/,
      );
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM seed").get().n, 0);
      const rows = listMigrationHistory(kit);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "error");
      assert.equal(rows[0].name, "bad");
      assert.match(rows[0].detail, /boom mid-migration/);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("history is ordered by started_at and keeps ok and error rows together", () => {
    const { dir, kit } = tmpKit();
    try {
      runNamedMigration(kit, "one", () => {});
      try {
        runNamedMigration(kit, "two", () => {
          throw new Error("nope");
        });
      } catch {
        /* expected */
      }
      runNamedMigration(kit, "three", () => {});
      const rows = listMigrationHistory(kit);
      assert.deepEqual(
        rows.map((r) => [r.name, r.status]).sort(),
        [
          ["one", "ok"],
          ["three", "ok"],
          ["two", "error"],
        ],
      );
      for (let i = 1; i < rows.length; i++) {
        assert.ok(rows[i - 1].started_at <= rows[i].started_at, "history must be ordered");
      }
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureMigrationRuns is idempotent and both helpers self-ensure on a bare kit", () => {
    const { dir, kit } = tmpKit();
    try {
      ensureMigrationRuns(kit);
      ensureMigrationRuns(kit);
      assert.deepEqual(listMigrationHistory(kit), []);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
