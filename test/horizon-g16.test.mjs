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
  resetG16Metrics,
  getG16PassTotal,
  incG16Pass,
} from "../src/eval/horizon-g16-metrics.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon G16", () => {
  it("apply lands G16; synthetic passes; optional in suite", async () => {
    const apply = path.join(root, "scripts/apply-n12j-g16.mjs");
    const ar = spawnSync(process.execPath, [apply], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(ar.status, 0, ar.stderr || ar.stdout);

    const { syntheticG16Job, runHorizonSuiteOffline } = await import(
      "../src/eval/horizon-offline.mjs?t=" + Date.now()
    );
    const cases = await loadCases({ id: "a4-G16-swarm-ballot-merge" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g16"));

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g16-"));
    const job = await syntheticG16Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetG16Metrics();
    if (scored.pass) incG16Pass();
    assert.ok(getG16PassTotal() >= 1);

    resetHorizonMetrics();
    const ws1 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g16a-"));
    const def = await runHorizonSuiteOffline({ workspace: ws1 });
    assert.equal(def.results.filter((x) => x.ok).length, 5);
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g16b-"));
    const with16 = await runHorizonSuiteOffline({
      workspace: ws2,
      includeG16: true,
    });
    assert.equal(with16.ok, true, JSON.stringify(with16));
    assert.ok(with16.results.filter((x) => x.ok).length >= 6);
  });
});
