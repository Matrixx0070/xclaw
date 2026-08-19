import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runHorizonSuiteOffline } from "../src/eval/horizon-offline.mjs";
import { resetHorizonMetrics } from "../src/eval/horizon-metrics.mjs";
import { loadCases } from "../src/eval/runner.mjs";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

describe("horizon suite default", () => {
  it("default suite includes G12 and G14 (5 cases)", async () => {
    resetHorizonMetrics();
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xclaw-hsd-"));
    const r = await runHorizonSuiteOffline({ workspace });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.results.filter((x) => x.ok).length, 5);
  });
  it("doctor requires >=5 horizon cases", async () => {
    const d = await doctorHorizon({});
    assert.ok(d.horizonCaseCount >= 5);
    assert.equal(d.ok, true);
  });
  it("loads G14 by tag horizon", async () => {
    const cases = await loadCases({ tag: "horizon" });
    assert.ok(cases.some((c) => c.id.includes("G14")));
  });
});
