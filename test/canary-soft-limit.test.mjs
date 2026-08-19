import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { softCanaryRecover } from "../src/agent/canary-recover.mjs";
import {
  resetCanaryMetrics,
  getCanaryUngroundedTotal,
} from "../src/agent/canary-metrics.mjs";

describe("canary soft limit", () => {
  it("soft recover only once via options flag pattern", () => {
    resetCanaryMetrics();
    const options = { _canarySoftUsed: false };
    const messages = [];
    const text = "I wrote the file successfully to disk.";
    if (options._canarySoftUsed !== true) {
      const soft = softCanaryRecover({ text, toolTrace: [], messages });
      if (soft.recovered) options._canarySoftUsed = true;
      assert.equal(soft.recovered, true);
    }
    assert.equal(options._canarySoftUsed, true);
    const messages2 = [];
    if (options._canarySoftUsed !== true) {
      softCanaryRecover({ text, toolTrace: [], messages: messages2 });
    }
    assert.equal(messages2.length, 0);
    assert.ok(getCanaryUngroundedTotal() >= 1);
  });
});
