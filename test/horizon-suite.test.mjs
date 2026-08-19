import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHorizonSuiteOffline } from "../src/eval/horizon-offline.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";
import { loadCases } from "../src/eval/runner.mjs";

describe("horizon suite", () => {
  it("runs G10+G11+G13 offline and passes", async () => {
    resetHorizonMetrics();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-hs-"));
    const r = await runHorizonSuiteOffline({ workspace });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.results.filter((x) => x.ok).length, 3);
  });
  it("includes G12 case definition", async () => {
    const cases = await loadCases({ id: "a4-G12-budget-near-limit" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g12"));
  });
});
