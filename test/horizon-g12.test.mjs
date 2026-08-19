import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCases } from "../src/eval/runner.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import {
  syntheticG12Job,
  runHorizonSuiteOffline,
} from "../src/eval/horizon-offline.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";

describe("horizon G12", () => {
  it("synthetic budget job passes grader", async () => {
    const cases = await loadCases({ id: "a4-G12-budget-near-limit" });
    assert.equal(cases.length, 1);
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g12-"));
    const job = await syntheticG12Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
  });
  it("suite with includeG12 passes 4", async () => {
    resetHorizonMetrics();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g12s-"));
    const r = await runHorizonSuiteOffline({ workspace, includeG12: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.results.filter((x) => x.ok).length, 4);
  });
});
