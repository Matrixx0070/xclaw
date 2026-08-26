/**
 * armSqlNoticeFilter swallows only node:sqlite's ExperimentalWarning.
 * Listeners captured at arm time still see every other warning.
 *
 * The swallow is proven in a child process so we can register a listener
 * BEFORE arming (in-process, loadBuiltinSql may already have armed).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { armSqlNoticeFilter, sqlNoticeFilterArmed } from "../src/persist/notice-filter.mjs";
import { loadBuiltinSql } from "../src/persist/engine-load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const filterUrl = pathToFileURL(path.join(here, "../src/persist/notice-filter.mjs")).href;

describe("sql notice filter", () => {
  it("is armed by loadBuiltinSql before node:sqlite loads", () => {
    loadBuiltinSql();
    assert.equal(sqlNoticeFilterArmed(), true);
  });

  it("armSqlNoticeFilter is idempotent", () => {
    armSqlNoticeFilter();
    const before = process.listeners("warning").length;
    armSqlNoticeFilter();
    armSqlNoticeFilter();
    assert.equal(
      process.listeners("warning").length,
      before,
      "second arm must not stack another warning listener",
    );
  });

  it("swallows sqlite ExperimentalWarning; forwards every other warning", () => {
    const script = `
      import { armSqlNoticeFilter } from ${JSON.stringify(filterUrl)};
      const seen = [];
      process.on("warning", (w) => seen.push((w?.name || "") + ":" + String(w?.message || "")));
      armSqlNoticeFilter();
      const sqliteW = new Error("SQLite is an experimental feature and might change at any time");
      sqliteW.name = "ExperimentalWarning";
      process.emit("warning", sqliteW);
      const otherW = new Error("Custom ESM loader is an experimental feature");
      otherW.name = "ExperimentalWarning";
      process.emit("warning", otherW);
      const dep = new Error("something else");
      dep.name = "DeprecationWarning";
      process.emit("warning", dep);
      const leaked = seen.filter((s) => /sqlite/i.test(s));
      if (leaked.length) {
        console.error("FAIL sqlite leaked", JSON.stringify(seen));
        process.exit(1);
      }
      if (!seen.some((s) => s.startsWith("ExperimentalWarning:") && /ESM loader/i.test(s))) {
        console.error("FAIL other ExperimentalWarning dropped", JSON.stringify(seen));
        process.exit(1);
      }
      if (!seen.some((s) => s.startsWith("DeprecationWarning:"))) {
        console.error("FAIL DeprecationWarning dropped", JSON.stringify(seen));
        process.exit(1);
      }
      process.exit(0);
    `;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout || "child failed");
  });
});
