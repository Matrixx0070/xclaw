import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAutonomyOfflineGate } from "../src/eval/autonomy-offline-gate.mjs";
import { recordLastDrain } from "../src/gateway/last-drain.mjs";

describe("autonomy offline gate", () => {
  it("passes with safe channel and low hardBlockRate", async () => {
    recordLastDrain({ sessionsKilled: 0, channel: "http", authMethod: "token" });
    const r = await runAutonomyOfflineGate({ hardBlockRate: 0.1 });
    assert.equal(r.ok, true, JSON.stringify(r.failed));
  });
  it("fails high hardBlockRate", async () => {
    const r = await runAutonomyOfflineGate({ hardBlockRate: 0.9 });
    assert.equal(r.ok, false);
    assert.ok(r.failed.includes("hard_block_rate_ceiling"));
  });
});
