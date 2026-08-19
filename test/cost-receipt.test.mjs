import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stampCostBlock } from "../src/agent/cost-receipt.mjs";

describe("cost receipt", () => {
  it("stamps evidence and receipt", () => {
    const job = { evidence: [], receipt: {} };
    const e = stampCostBlock(job, { reason: "max_usd", used: 2 });
    assert.equal(e.type, "cost_governor");
    assert.equal(job.evidence.length, 1);
    assert.equal(job.receipt.costBlocks.length, 1);
  });
});
