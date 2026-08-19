import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCases } from "../src/eval/runner.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import { syntheticG14Job } from "../src/eval/horizon-offline.mjs";
import {
  resetG14Metrics,
  getG14PassTotal,
  incG14Pass,
} from "../src/eval/horizon-g14-metrics.mjs";

describe("horizon G14", () => {
  it("case + fixture exist; synthetic passes", async () => {
    const cases = await loadCases({ id: "a4-G14-multi-file-refactor" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g14"));
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g14-"));
    const job = await syntheticG14Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetG14Metrics();
    if (scored.pass) incG14Pass();
    assert.ok(getG14PassTotal() >= 1);
  });
});
