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
  resetG19Metrics,
  getG19PassTotal,
  incG19Pass,
} from "../src/eval/horizon-g19-metrics.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon G19", () => {
  it("apply lands G19; synthetic passes; optional in suite", async () => {
    const apply = path.join(root, "scripts/apply-n12m-g19.mjs");
    const ar = spawnSync(process.execPath, [apply], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(ar.status, 0, ar.stderr || ar.stdout);

    const { syntheticG19Job, runHorizonSuiteOffline } = await import(
      "../src/eval/horizon-offline.mjs?t=" + Date.now()
    );
    const cases = await loadCases({ id: "a4-G19-canary-partial-evidence" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g19"));

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g19-"));
    const job = await syntheticG19Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetG19Metrics();
    if (scored.pass) incG19Pass();
    assert.ok(getG19PassTotal() >= 1);

    resetHorizonMetrics();
    const ws1 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g19a-"));
    const def = await runHorizonSuiteOffline({ workspace: ws1 });
    assert.equal(def.results.filter((x) => x.ok).length, 5);
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g19b-"));
    const with19 = await runHorizonSuiteOffline({
      workspace: ws2,
      includeG19: true,
    });
    assert.equal(with19.ok, true, JSON.stringify(with19));
    assert.ok(with19.results.filter((x) => x.ok).length >= 6);
  });
});
