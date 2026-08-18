import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attachReceiptCollectorToJob } from "../src/jobs/finalize-receipt.mjs";
import { createReceiptCollector } from "../src/jobs/receipt-collector.mjs";

describe("attachReceiptCollectorToJob", () => {
  it("copies collector + synthesizes circuit before recordJob", () => {
    const collector = createReceiptCollector({
      quotaEscalate: { hardBlocks: 3, softWarns: 0, escalatedFromSoft: 0 },
    });
    const job = { id: "j1", status: "cancelled" };
    attachReceiptCollectorToJob(job, {
      agentResult: { receiptCollector: collector },
    });
    assert.equal(job.quotaEscalate.hardBlocks, 3);
    assert.equal(job.quotaHardCircuit.tripped, true);
  });
});
