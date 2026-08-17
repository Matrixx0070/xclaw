import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCuaI6Suite, summarizeCuaRows } from "../src/eval/cua-graders.mjs";

describe("CUA I6 suite", () => {
  it("all policy contracts pass", async () => {
    const rows = await runCuaI6Suite();
    const s = summarizeCuaRows(rows);
    assert.equal(s.fail, 0, JSON.stringify(rows.filter((r) => !r.pass), null, 2));
    assert.equal(s.total, 8);
  });
});
