import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCases } from "../src/eval/runner.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import {
  syntheticG15Job,
  runHorizonSuiteOffline,
} from "../src/eval/horizon-offline.mjs";
import { mockBrowserFormFill } from "../src/eval/horizon-g15-browser-mock.mjs";
import {
  resetG15Metrics,
  getG15PassTotal,
  incG15Pass,
} from "../src/eval/horizon-g15-metrics.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";

describe("horizon G15", () => {
  it("case + fixture; synthetic passes", async () => {
    const cases = await loadCases({ id: "a4-G15-browser-form-fill" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g15"));
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g15-"));
    const job = await syntheticG15Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetG15Metrics();
    if (scored.pass) incG15Pass();
    assert.ok(getG15PassTotal() >= 1);
  });
  it("browser mock is deterministic", () => {
    const r = mockBrowserFormFill({ name: "Ada", email: "ada@example.com" });
    assert.equal(r.ok, true);
    assert.equal(r.resultText, "SUBMITTED-OK");
  });
  it("optional includeG15 adds 6th case; default stays 5", async () => {
    resetHorizonMetrics();
    const ws1 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g15a-"));
    const def = await runHorizonSuiteOffline({ workspace: ws1 });
    assert.equal(def.results.filter((x) => x.ok).length, 5);
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g15b-"));
    const with15 = await runHorizonSuiteOffline({
      workspace: ws2,
      includeG15: true,
    });
    assert.equal(with15.ok, true, JSON.stringify(with15));
    assert.equal(with15.results.filter((x) => x.ok).length, 6);
  });
});
