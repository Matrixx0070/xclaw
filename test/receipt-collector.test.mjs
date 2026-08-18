import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReceiptCollector, copyCollectorOntoJob } from "../src/jobs/receipt-collector.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("receiptCollector", () => {
  it("creates zeroed counters", () => {
    const c = createReceiptCollector();
    assert.equal(c.quotaEscalate.hardBlocks, 0);
    assert.equal(c.claimsSoftRetry.used, 0);
  });

  it("copies onto job", () => {
    const job = { id: "j" };
    const c = createReceiptCollector();
    c.quotaEscalate.hardBlocks = 2;
    copyCollectorOntoJob(job, c);
    assert.equal(job.quotaEscalate.hardBlocks, 2);
  });

  it("job.mjs patch or live collector is present", () => {
    const src = fs.readFileSync(path.join(root, "src/jobs/job.mjs"), "utf8");
    const patched = src.includes("receiptCollector");
    const patch = fs.existsSync(path.join(root, "patches/job-receipt-collector.patch"));
    assert.ok(patched || patch);
  });
});
