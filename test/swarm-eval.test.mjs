import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSwarmReceipt, attachChildReceipt } from "../src/jobs/swarm-receipt.mjs";
import { scoreSwarm } from "../src/eval/swarm-eval.mjs";

describe("swarm eval", () => {
  it("passes high completion low hard blocks", () => {
    const s = createSwarmReceipt("p");
    attachChildReceipt(s, { id: "1", pass: true, usd: 0.01 });
    attachChildReceipt(s, { id: "2", pass: true, usd: 0.01 });
    const r = scoreSwarm(s);
    assert.equal(r.ok, true);
  });
  it("fails high hardBlockRate", () => {
    const s = createSwarmReceipt("p");
    for (let i = 0; i < 4; i++) {
      attachChildReceipt(s, { id: String(i), pass: true, hardBlocks: 1 });
    }
    const r = scoreSwarm(s, { maxHardBlockRate: 0.25 });
    assert.equal(r.ok, false);
    assert.equal(r.ceilingExceeded, true);
  });
});
