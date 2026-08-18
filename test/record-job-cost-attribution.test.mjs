import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stampJobCostEvent } from "../src/jobs/job-cost-attribution.mjs";

describe("recordJobCost attribution event", () => {
  it("stampJobCostEvent is what ledger should store", () => {
    const ev = stampJobCostEvent({
      usd: 0.25,
      jobId: "j9",
      estimated: false,
      result: { model: "xai/grok-2", usd: 0.25 },
    });
    assert.equal(ev.jobId, "j9");
    assert.equal(ev.usd, 0.25);
    assert.equal(ev.attribution.totalUsd, 0.25);
    assert.equal(ev.attribution.models[0].modelRef, "xai/grok-2");
  });
});
