/**
 * Schema retirement list (spec §12.2) — ships empty; retired names still
 * present WARN in doctor; `--fix` drops retired indexes and only EMPTY
 * retired tables; nothing in the shipping DDL may name a retired entry;
 * default doctor never drops.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openKit } from "../src/persist/query-kit.mjs";
import {
  dropRetiredIfEmpty,
  listRetiredPresent,
  loadRetirements,
} from "../src/state/schema-retirements.mjs";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-retire-"));
  const kit = openKit(path.join(dir, "t.sqlite"), { label: "retire test" });
  return { dir, kit };
}

const RETIRE = {
  control: {
    retiredTables: ["old_ledger"],
    retiredIndexes: ["old_ledger_idx"],
  },
};

describe("schema retirements (spec §12.2)", () => {
  it("ships with empty lists for control and agent", () => {
    const r = loadRetirements();
    assert.deepEqual(r.control.retiredTables, []);
    assert.deepEqual(r.control.retiredIndexes, []);
    assert.deepEqual(r.agent.retiredTables, []);
    assert.deepEqual(r.agent.retiredIndexes, []);
    assert.match(r.control.notes, /must not CREATE a retired table/);
  });

  it("empty lists detect nothing; retired names present are listed by type", () => {
    const { dir, kit } = tmpDb();
    try {
      kit.exec("CREATE TABLE old_ledger (v TEXT); CREATE INDEX old_ledger_idx ON old_ledger(v); CREATE TABLE live (v TEXT)");
      assert.deepEqual(listRetiredPresent(kit.db, "control"), []);
      const present = listRetiredPresent(kit.db, "control", RETIRE);
      assert.deepEqual(
        present.sort((a, b) => a.name.localeCompare(b.name)),
        [
          { name: "old_ledger", type: "table" },
          { name: "old_ledger_idx", type: "index" },
        ],
      );
      assert.deepEqual(listRetiredPresent(kit.db, "agent", RETIRE), []);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fix drops the retired index and an EMPTY retired table; a populated one is kept", () => {
    const { dir, kit } = tmpDb();
    try {
      kit.exec("CREATE TABLE old_ledger (v TEXT); CREATE INDEX old_ledger_idx ON old_ledger(v)");
      const r1 = dropRetiredIfEmpty(kit.db, "control", RETIRE);
      assert.deepEqual(r1.dropped.sort(), ["old_ledger", "old_ledger_idx"]);
      assert.deepEqual(r1.kept, []);
      assert.deepEqual(listRetiredPresent(kit.db, "control", RETIRE), []);

      kit.exec("CREATE TABLE old_ledger (v TEXT)");
      kit.prepare("INSERT INTO old_ledger(v) VALUES ('keep-me')").run();
      const r2 = dropRetiredIfEmpty(kit.db, "control", RETIRE);
      assert.deepEqual(r2.dropped, []);
      assert.deepEqual(r2.kept, ["old_ledger(1 rows)"]);
      assert.equal(kit.prepare("SELECT COUNT(*) AS n FROM old_ledger").get().n, 1);
    } finally {
      kit.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no retired name collides with the shipping DDL (fix must never CREATE one)", () => {
    const r = loadRetirements();
    const retired = new Set([
      ...r.control.retiredTables,
      ...r.control.retiredIndexes,
      ...r.agent.retiredTables,
      ...r.agent.retiredIndexes,
    ]);
    const sources = [
      "../src/state/control-plane.mjs",
      "../src/state/control-schema.sql",
      "../src/state/agent-store.mjs",
    ].map((p) => fs.readFileSync(new URL(p, import.meta.url), "utf8"));
    for (const name of retired) {
      for (const src of sources) {
        assert.equal(src.includes(name), false, `retired name ${name} appears in shipping DDL`);
      }
    }
  });

  it("doctor warns on present retired names; --fix wires dropRetiredIfEmpty on the control plane", () => {
    const doctor = fs.readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    assert.match(doctor, /listRetiredPresent\(db, "control"\)/);
    assert.match(doctor, /"sql\.retirements",\s*\n\s*"warn"/);
    const fix = fs.readFileSync(new URL("../src/cli/doctor-fix.mjs", import.meta.url), "utf8");
    assert.match(fix, /dropRetiredIfEmpty\(plane\.db, "control"\)/);
    assert.match(fix, /"fix\.retirements"/);
    const openSrc = fs.readFileSync(new URL("../src/state/control-plane.mjs", import.meta.url), "utf8");
    assert.equal(openSrc.includes("dropRetiredIfEmpty"), false, "open path never drops");
  });
});
