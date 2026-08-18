import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordHardBlock } from "../src/agent/quota-hard-circuit.mjs";
import { createReceiptCollector } from "../src/jobs/receipt-collector.mjs";

describe("recordHardBlock stamps collector", () => {
  it("copies circuit onto separate collector", () => {
    const job = {};
    const collector = createReceiptCollector();
    recordHardBlock(job, { cfg: { quota: { maxHardBlocksPerJob: 1 } }, collector });
    assert.equal(job.quotaHardCircuit.tripped, true);
    assert.equal(collector.quotaHardCircuit.tripped, true);
    assert.equal(collector.quotaEscalate.hardBlocks, 1);
  });
});
