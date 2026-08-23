import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createClaimsSoftRetryBudget,
  stampClaimsSoftRetryOnJob,
  resolveClaimsSoftRetryMax,
} from "../src/agent/claims-soft-retry.mjs";
import { applyClaimsGateToResult } from "../src/agent/claims-gate.mjs";
import { copyCollectorOntoJob, createReceiptCollector } from "../src/jobs/receipt-collector.mjs";

describe("claims soft-retry budget", () => {
  it("defaults max to 1", () => {
    assert.equal(resolveClaimsSoftRetryMax({}), 1);
    assert.equal(resolveClaimsSoftRetryMax({ jobs: { claimsSoftRetry: false } }), 0);
  });

  it("records until exhausted", () => {
    const b = createClaimsSoftRetryBudget({ max: 1 });
    const a = b.record({ warnings: ["w1"] });
    assert.equal(a.ok, true);
    assert.equal(a.used, 1);
    assert.equal(a.remaining, 0);
    const x = b.record({ warnings: ["w2"] });
    assert.equal(x.ok, false);
    assert.equal(x.reason, "budget_exhausted");
  });

  it("stamps job receipt", () => {
    const b = createClaimsSoftRetryBudget({ max: 2 });
    b.record({ warnings: ["a"] });
    const job = { id: "j1", pass: true };
    stampClaimsSoftRetryOnJob(job, b);
    assert.equal(job.claimsSoftRetry.used, 1);
    assert.equal(job.claimsSoftRetry.max, 2);
  });

  it("applyClaimsGateToResult attaches budget when provided", () => {
    const b = createClaimsSoftRetryBudget({ max: 1 });
    b.record({ warnings: ["soft"] });
    const out = applyClaimsGateToResult(
      { text: "hello", evidence: [] },
      { softRetryBudget: b, cfg: {}, opts: {} }
    );
    assert.ok(out.claimsSoftRetry);
    assert.equal(out.claimsSoftRetry.used, 1);
    assert.equal(out.claimsGate.softRetryBudget.used, 1);
  });
});

// 2026-08-23 soak diagnosis: attachReceiptCollectorToJob ran after the gate
// stamped the real budget and clobbered it with the collector's pristine
// {max:0} default — every receipt reported max:0/used:0 and hid the retry
// state. The pristine default must never overwrite a stamped budget.
describe("collector default does not clobber a stamped budget", () => {
  it("pristine collector leaves the stamped budget alone", () => {
    const job = { claimsSoftRetry: { max: 1, used: 1, remaining: 0, attempts: [{ at: "t" }] } };
    copyCollectorOntoJob(job, createReceiptCollector());
    assert.equal(job.claimsSoftRetry.max, 1);
    assert.equal(job.claimsSoftRetry.used, 1);
  });

  it("a collector carrying data still copies", () => {
    const job = { claimsSoftRetry: { max: 1, used: 0, remaining: 1, attempts: [] } };
    const c = createReceiptCollector({ claimsSoftRetry: { max: 2, used: 2, remaining: 0, attempts: [{}, {}] } });
    copyCollectorOntoJob(job, c);
    assert.equal(job.claimsSoftRetry.used, 2);
  });

  it("a job with no budget accepts the default", () => {
    const job = {};
    copyCollectorOntoJob(job, createReceiptCollector());
    assert.equal(job.claimsSoftRetry.max, 0);
  });
});
