
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateUsd, rateForModel } from "../src/eval/cost.mjs";

describe("eval cost", () => {
  it("estimates positive usd for tokens", () => {
    const e = estimateUsd({ prompt: 1_000_000, completion: 1_000_000 }, "grok-4.3");
    assert.ok(e.usd > 0);
    assert.equal(e.rates.in, 3);
  });
  it("matches model rates", () => {
    assert.equal(rateForModel("gpt-4o-mini").out, 0.6);
  });
});
