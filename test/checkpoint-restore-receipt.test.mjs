import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  receiptFromCheckpoint,
  applyCheckpointReceipt,
} from "../src/jobs/checkpoint-restore-receipt.mjs";

describe("resume restores quotaEscalate", () => {
  it("copies counters from checkpoint", () => {
    const c = receiptFromCheckpoint({
      quotaEscalate: { softWarns: 3, hardBlocks: 1, escalatedFromSoft: 1, lastCode: "Q" },
    });
    assert.equal(c.quotaEscalate.softWarns, 3);
    assert.equal(c.quotaEscalate.hardBlocks, 1);
  });

  it("applyCheckpointReceipt mutates job", () => {
    const job = { id: "r" };
    applyCheckpointReceipt(job, {
      claimsSoftRetry: { max: 2, used: 1, remaining: 1, attempts: [{}] },
    });
    assert.equal(job.claimsSoftRetry.used, 1);
  });
});
