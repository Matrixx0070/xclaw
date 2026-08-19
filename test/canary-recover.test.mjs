import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { softCanaryRecover } from "../src/agent/canary-recover.mjs";
import {
  resetCanaryMetrics,
  getCanaryUngroundedTotal,
} from "../src/agent/canary-metrics.mjs";

describe("canary recover", () => {
  it("injects verify turn when ungrounded", () => {
    resetCanaryMetrics();
    const messages = [];
    const r = softCanaryRecover({
      text: "I wrote the file successfully to disk.",
      toolTrace: [],
      messages,
    });
    assert.equal(r.recovered, true);
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /canary/i);
    assert.ok(getCanaryUngroundedTotal() >= 1);
  });
  it("no recover when grounded", () => {
    const messages = [];
    const r = softCanaryRecover({
      text: "I wrote the file successfully.",
      toolTrace: [{ name: "xclaw_file_write", status: "ok" }],
      messages,
    });
    assert.equal(r.recovered, false);
    assert.equal(messages.length, 0);
  });
});
