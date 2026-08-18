import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ensureJobReceiptCollector,
  attachReceiptCollectorToJob,
} from "../src/jobs/finalize-receipt.mjs";

describe("ensure job receipt collector", () => {
  it("always creates a collector when missing", () => {
    const job = { id: "j1" };
    const c = ensureJobReceiptCollector(job);
    assert.ok(c);
    assert.ok(job.receiptCollector);
    assert.equal(c.quotaEscalate.hardBlocks, 0);
  });

  it("attach without sources still gets a collector", () => {
    const job = { id: "j2", status: "cancelled" };
    attachReceiptCollectorToJob(job, {});
    assert.ok(job.receiptCollector);
  });
});
