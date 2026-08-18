import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildReceiptMetrics,
  stampReceiptMetrics,
  recordQuotaEscalateEvent,
} from "../src/jobs/receipt-metrics.mjs";

describe("receipt metrics", () => {
  it("builds claims soft-retry snapshot", () => {
    const m = buildReceiptMetrics({
      claimsSoftRetry: { max: 2, used: 1, remaining: 1, attempts: [{ at: "x" }] },
    });
    assert.equal(m.claimsSoftRetry.used, 1);
    assert.equal(m.claimsSoftRetry.max, 2);
    assert.equal(m.claimsSoftRetry.attempts, 1);
  });

  it("records quota escalate events", () => {
    const job = {};
    recordQuotaEscalateEvent(job, { soft: true });
    recordQuotaEscalateEvent(job, {
      hard: true,
      escalatedFromSoft: true,
      code: "WORKSPACE_QUOTA_SOFT_ESCALATED",
    });
    assert.equal(job.quotaEscalate.softWarns, 1);
    assert.equal(job.quotaEscalate.hardBlocks, 1);
    assert.equal(job.quotaEscalate.escalatedFromSoft, 1);
    assert.equal(job.quotaEscalate.lastCode, "WORKSPACE_QUOTA_SOFT_ESCALATED");
    stampReceiptMetrics(job);
    assert.equal(job.receiptMetrics.quotaEscalate.escalatedFromSoft, 1);
  });
});
