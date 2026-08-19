import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCases } from "../src/eval/runner.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import { syntheticG10Job } from "../src/eval/horizon-offline.mjs";
import {
  resetHorizonMetrics,
  getHorizonPassTotal,
  incHorizonPass,
} from "../src/eval/horizon-metrics.mjs";

describe("horizon G10", () => {
  it("case exists and synthetic job passes grader", async () => {
    const cases = await loadCases({ id: "a4-G10-plan-write-verify-fix" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("horizon"));
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g10-"));
    const job = await syntheticG10Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetHorizonMetrics();
    if (scored.pass) incHorizonPass();
    assert.ok(getHorizonPassTotal() >= 1);
  });
});
