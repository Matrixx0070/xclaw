import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attributionFromJobResult,
  stampJobCostEvent,
} from "../src/jobs/job-cost-attribution.mjs";

describe("job cost attribution stamp", () => {
  it("splits slices after failover", () => {
    const attr = attributionFromJobResult({
      id: "j1",
      costSlices: [
        { modelRef: "xai/grok-2", usd: 0.4 },
        { modelRef: "xai/grok-2-mini", usd: 0.1, reason: "failover" },
      ],
      failover: { fromRef: "xai/grok-2", toRef: "xai/grok-2-mini", remainingUsd: 0.6 },
    });
    assert.equal(attr.totalUsd, 0.5);
    assert.equal(attr.lastFailover.toRef, "xai/grok-2-mini");
  });

  it("stampJobCostEvent embeds summary", () => {
    const ev = stampJobCostEvent({
      usd: 0.5,
      jobId: "j1",
      result: { model: "xai/grok-2", usd: 0.5 },
    });
    assert.equal(ev.jobId, "j1");
    assert.equal(ev.attribution.totalUsd, 0.5);
    assert.equal(ev.attribution.models[0].modelRef, "xai/grok-2");
  });
});
