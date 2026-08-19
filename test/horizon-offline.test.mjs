import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCases } from "../src/eval/runner.mjs";
import { runHorizonOffline, syntheticG10Job } from "../src/eval/horizon-offline.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";

describe("horizon offline", () => {
  it("loads G10 G11 G13 by tag", async () => {
    const cases = await loadCases({ tag: "horizon" });
    const ids = new Set(cases.map((c) => c.id));
    assert.ok(ids.has("a4-G10-plan-write-verify-fix"));
    assert.ok(ids.has("a4-G11-tool-fail-recover"));
    assert.ok(ids.has("a4-G13-canary-then-ground"));
  });
  it("G10 offline synthetic via runner", async () => {
    resetHorizonMetrics();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-hz-"));
    const job = await syntheticG10Job(workspace);
    const r = await runHorizonOffline({
      ids: ["a4-G10-plan-write-verify-fix"],
      jobs: { "a4-G10-plan-write-verify-fix": job },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.metrics, /xclaw_autonomy_horizon_pass_total/);
  });
});
