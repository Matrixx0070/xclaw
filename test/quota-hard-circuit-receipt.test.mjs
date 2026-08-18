import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyCollectorOntoJob, createReceiptCollector } from "../src/jobs/receipt-collector.mjs";
import { recordJob } from "../src/jobs/history.mjs";

describe("quotaHardCircuit on receipts", () => {
  it("copies circuit onto job", () => {
    const job = {};
    const c = createReceiptCollector({
      quotaHardCircuit: { tripped: true, hardBlocks: 3, limit: 3 },
    });
    copyCollectorOntoJob(job, c);
    assert.equal(job.quotaHardCircuit.tripped, true);
  });

  it("stamps index.jsonl", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-qhc-"));
    const cfg = { paths: { configDir: dir } };
    const { slim } = await recordJob(cfg, {
      id: "j1",
      goal: "g",
      status: "failed",
      quotaHardCircuit: { tripped: true, hardBlocks: 3 },
    });
    assert.equal(slim.quotaHardCircuit.tripped, true);
    const line = fs.readFileSync(path.join(dir, "jobs", "index.jsonl"), "utf8");
    assert.ok(line.includes("quotaHardCircuit"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
