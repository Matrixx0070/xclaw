import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSwarmReceipt, attachChildReceipt, swarmReceiptSummary } from "../src/jobs/swarm-receipt.mjs";

describe("swarm receipt aggregator", () => {
  it("aggregates children cost and hard blocks", () => {
    const s = createSwarmReceipt("parent1");
    attachChildReceipt(s, { id: "c1", usd: 0.1, quotaEscalate: { hardBlocks: 1 }, toolHashTip: "abc" });
    attachChildReceipt(s, { id: "c2", usd: 0.2, pass: true });
    const sum = swarmReceiptSummary(s);
    assert.equal(sum.childCount, 2);
    assert.ok(Math.abs(sum.totalUsd - 0.3) < 1e-9);
    assert.equal(sum.hardBlocks, 1);
  });
});
