/**
 * SQL-first generated types (spec §12.3) — the committed generated file
 * matches a fresh run of the codegen (drift guard, byte-identical), the
 * columns mirror the starter schema, and no runtime module imports the
 * generated file (runtime stays on query-kit / openLocalSql).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { CONTROL_COLUMNS } from "../src/state/control-schema.generated.mjs";

describe("generated control types (spec §12.3)", () => {
  it("committed file matches a fresh codegen run byte-for-byte", () => {
    const genPath = new URL("../src/state/control-schema.generated.mjs", import.meta.url);
    const before = fs.readFileSync(genPath, "utf8");
    try {
      execFileSync(process.execPath, [new URL("../scripts/gen-control-types.mjs", import.meta.url).pathname]);
      const after = fs.readFileSync(genPath, "utf8");
      assert.equal(after, before, "generated file drifted — run scripts/gen-control-types.mjs and commit");
    } finally {
      fs.writeFileSync(genPath, before);
    }
  });

  it("columns mirror the starter schema tables", () => {
    assert.deepEqual(Object.keys(CONTROL_COLUMNS).sort(), ["migration_runs", "schema_meta"]);
    assert.deepEqual(CONTROL_COLUMNS.schema_meta, ["key", "version", "touched_at"]);
    assert.deepEqual(CONTROL_COLUMNS.migration_runs, [
      "id",
      "name",
      "started_at",
      "finished_at",
      "status",
      "detail",
    ]);
  });

  it("no runtime module imports the generated file", () => {
    const hits = [];
    for (const e of fs.readdirSync(new URL("../src", import.meta.url), { recursive: true })) {
      const f = new URL(`../src/${e}`, import.meta.url).pathname;
      if (!f.endsWith(".mjs") || f.endsWith(".generated.mjs")) continue;
      if (fs.statSync(f).isFile() && fs.readFileSync(f, "utf8").includes("control-schema.generated")) {
        hits.push(f);
      }
    }
    assert.deepEqual(hits, []);
  });
});
