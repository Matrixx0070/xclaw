/**
 * Memory vector extension loader (spec §12.4) — refuses on a handle
 * opened WITHOUT allowExtension; with the option it walks candidates
 * ($XCLAW_SQLITE_VEC first) and reports not-ready when none loads (no
 * real sqlite-vec binary ships in this repo); extension loading is
 * re-disabled after the attempt; doctor probes only when
 * `memory.vec === true` (default config never mentions vec); the memory
 * index never opens with allowExtension by default.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import fs from "node:fs";
import { openLocalSql } from "../src/persist/engine-load.mjs";
import { tryLoadVec } from "../src/persist/vec-extension.mjs";

let savedVec;

describe("vec extension loader (spec §12.4)", () => {
  beforeEach(() => {
    savedVec = process.env.XCLAW_SQLITE_VEC;
    delete process.env.XCLAW_SQLITE_VEC;
  });
  afterEach(() => {
    if (savedVec === undefined) delete process.env.XCLAW_SQLITE_VEC;
    else process.env.XCLAW_SQLITE_VEC = savedVec;
  });

  it("refuses distinctly (refused:true) on a handle opened without allowExtension", () => {
    const db = openLocalSql(":memory:");
    try {
      assert.deepEqual(tryLoadVec(db), { ready: false, refused: true });
    } finally {
      db.close();
    }
  });

  it("with allowExtension: walks candidates, not-ready when none loads, loading re-disabled after", () => {
    process.env.XCLAW_SQLITE_VEC = "/nonexistent-vec-candidate";
    const db = openLocalSql(":memory:", { allowExtension: true });
    try {
      const r = tryLoadVec(db);
      assert.equal(r.ready, false);
      assert.equal(r.refused, undefined, "allowExtension handle is not a refusal");
      assert.throws(
        () => db.loadExtension("/nonexistent-vec-candidate"),
        /not authorized|disabled|not allowed/i,
        "extension loading must be re-disabled after the attempt",
      );
    } finally {
      db.close();
    }
  });

  it("uses the loadExtension METHOD (node:sqlite refuses the SQL function) and verifies vec_version", () => {
    const src = fs.readFileSync(new URL("../src/persist/vec-extension.mjs", import.meta.url), "utf8");
    assert.match(src, /db\.loadExtension\(String\(file\)\)/);
    assert.match(src, /SELECT vec_version\(\)/);
    assert.doesNotMatch(src, /SELECT load_extension/);
    assert.match(src, /process\.env\.XCLAW_SQLITE_VEC/);
    assert.match(src, /native\/sqlite-vec/);
  });

  it("doctor probes vec only when memory.vec === true; memory index stays extension-free by default", () => {
    const doctor = fs.readFileSync(new URL("../src/cli/doctor.mjs", import.meta.url), "utf8");
    assert.match(doctor, /if \(cfg\.memory\?\.vec === true\) \{/);
    assert.match(doctor, /openLocalSql\(":memory:", \{ allowExtension: true \}\)/);
    assert.match(doctor, /"sql\.vec"/);
    const idx = fs.readFileSync(new URL("../src/memory/search-index.mjs", import.meta.url), "utf8");
    assert.equal(idx.includes("allowExtension: true"), false, "memory index never opens with allowExtension by default");
    assert.equal(idx.includes("tryLoadVec"), false);
  });
});
