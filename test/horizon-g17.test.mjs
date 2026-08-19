import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCases } from "../src/eval/runner.mjs";
import { scoreCase } from "../src/eval/scorer.mjs";
import {
  resetG17Metrics,
  getG17PassTotal,
  incG17Pass,
} from "../src/eval/horizon-g17-metrics.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon G17", () => {
  it("apply lands G17; synthetic passes; optional in suite", async () => {
    const apply = path.join(root, "scripts/apply-n12k-g17.mjs");
    const ar = spawnSync(process.execPath, [apply], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(ar.status, 0, ar.stderr || ar.stdout);

    const { syntheticG17Job, runHorizonSuiteOffline } = await import(
      "../src/eval/horizon-offline.mjs?t=" + Date.now()
    );
    const cases = await loadCases({ id: "a4-G17-overnight-soak" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g17"));

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g17-"));
    const job = await syntheticG17Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetG17Metrics();
    if (scored.pass) incG17Pass();
    assert.ok(getG17PassTotal() >= 1);

    resetHorizonMetrics();
    const ws1 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g17a-"));
    const def = await runHorizonSuiteOffline({ workspace: ws1 });
    assert.equal(def.results.filter((x) => x.ok).length, 5);
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g17b-"));
    const with17 = await runHorizonSuiteOffline({
      workspace: ws2,
      includeG17: true,
    });
    assert.equal(with17.ok, true, JSON.stringify(with17));
    assert.ok(with17.results.filter((x) => x.ok).length >= 6);
  });
});
