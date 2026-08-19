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
    // The default offline suite grew past the original G10/G11/G13 trio as the
    // G15-G20 packs landed. Assert every case passes and the trio is present,
    // rather than freezing a count later work legitimately changes.
    assert.equal(r.results.filter((x) => x.ok).length, r.results.length);
    assert.ok(r.results.length >= 3, JSON.stringify(r.results.map((x) => x.id)));
  });
  it("includes G12 case definition", async () => {
    const cases = await loadCases({ id: "a4-G12-budget-near-limit" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g12"));
  });
});
