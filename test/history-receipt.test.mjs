import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeReceiptSnapshotIntoJob, snapshotReceiptForHistory } from "../src/jobs/history-receipt.mjs";
import { createReceiptCollector } from "../src/jobs/receipt-collector.mjs";

describe("history receipt snapshot", () => {
  it("serializes collector fields", () => {
    const job = { id: "j1", receiptCollector: createReceiptCollector({ quotaEscalate: { hardBlocks: 2, softWarns: 0, escalatedFromSoft: 0 } }) };
    const snap = snapshotReceiptForHistory(job);
    assert.equal(snap.quotaEscalate.hardBlocks, 2);
    mergeReceiptSnapshotIntoJob(job);
    assert.ok(job.receiptCollector.quotaEscalate || job.quotaEscalate);
  });
});
