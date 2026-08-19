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
  resetG20Metrics,
  getG20PassTotal,
  incG20Pass,
} from "../src/eval/horizon-g20-metrics.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("horizon G20", () => {
  it("apply lands G20; synthetic passes; optional in suite; pack complete", async () => {
    const apply = path.join(root, "scripts/apply-n12n-g20.mjs");
    const ar = spawnSync(process.execPath, [apply], {
      encoding: "utf8",
      cwd: root,
    });
    assert.equal(ar.status, 0, ar.stderr || ar.stdout);

    const { syntheticG20Job, runHorizonSuiteOffline } = await import(
      "../src/eval/horizon-offline.mjs?t=" + Date.now()
    );
    const cases = await loadCases({ id: "a4-G20-cost-stop-resume" });
    assert.equal(cases.length, 1);
    assert.ok(cases[0].tags.includes("g20"));

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g20-"));
    const job = await syntheticG20Job(workspace);
    const scored = await scoreCase(cases[0], job);
    assert.equal(scored.pass, true, JSON.stringify(scored));
    resetG20Metrics();
    if (scored.pass) incG20Pass();
    assert.ok(getG20PassTotal() >= 1);

    resetHorizonMetrics();
    const ws1 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g20a-"));
    const def = await runHorizonSuiteOffline({ workspace: ws1 });
    assert.equal(def.results.filter((x) => x.ok).length, 5);
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-g20b-"));
    const with20 = await runHorizonSuiteOffline({
      workspace: ws2,
      includeG20: true,
    });
    assert.equal(with20.ok, true, JSON.stringify(with20));
    assert.ok(with20.results.filter((x) => x.ok).length >= 6);

    const d = await doctorHorizon({});
    assert.equal(d.hasG20, true);
    assert.equal(d.packComplete, true);
  });
});
