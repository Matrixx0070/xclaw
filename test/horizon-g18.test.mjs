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
  resetG18Metrics,
  getG18PassTotal,
  incG18Pass,
} from "../src/eval/horizon-g18-metrics.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon G18", () => {
  it("apply lands G18; synthetic passes; optional in suite", async () => {
    const apply = path.join(root, "scripts/apply-n12l-g18.mjs");
    const ar = spawnSync(process.execPath, [apply], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(ar.status, 0, ar.stderr || ar.stdout);

    const { syntheticG18Job, runHorizonSuiteOffline } = await import(
      "../src/eval/horizon-offline.mjs?t=" + Date.now()
    );
    const cases = await loadCases({ id: "a4-G18-oauth-refresh-midrun" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g18"));

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g18-"));
    const job = await syntheticG18Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetG18Metrics();
    if (scored.pass) incG18Pass();
    assert.ok(getG18PassTotal() >= 1);

    resetHorizonMetrics();
    const ws1 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g18a-"));
    const def = await runHorizonSuiteOffline({ workspace: ws1 });
    assert.equal(def.results.filter((x) => x.ok).length, 5);
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g18b-"));
    const with18 = await runHorizonSuiteOffline({
      workspace: ws2,
      includeG18: true,
    });
    assert.equal(with18.ok, true, JSON.stringify(with18));
    assert.ok(with18.results.filter((x) => x.ok).length >= 6);
  });
});
