import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptyAttribution,
  attributeSpend,
  noteFailover,
  attributionSummary,
} from "../src/tokens/cost-attribution.mjs";

describe("cost attribution", () => {
  it("splits spend across model refs", () => {
    let a = emptyAttribution();
    a = attributeSpend(a, "xai/grok-2", 0.4, { jobId: "j1" });
    a = noteFailover(a, "xai/grok-2", "xai/grok-2-mini", 0.6);
    a = attributeSpend(a, "xai/grok-2-mini", 0.25, { reason: "failover" });
    const s = attributionSummary(a);
    assert.equal(s.totalUsd, 0.65);
    assert.equal(s.models.length, 2);
    assert.equal(s.models.find((m) => m.modelRef === "xai/grok-2").usd, 0.4);
    assert.equal(s.lastFailover.toRef, "xai/grok-2-mini");
  });

  it("ignores negative usd", () => {
    const a = attributeSpend(emptyAttribution(), "xai/a", -1);
    assert.equal(a.totalUsd, 0);
  });
});
