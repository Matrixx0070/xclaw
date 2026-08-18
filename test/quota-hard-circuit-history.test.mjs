import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordHardBlock } from "../src/agent/quota-hard-circuit.mjs";
import { createReceiptCollector, ensureQuotaHardCircuitOnJob } from "../src/jobs/receipt-collector.mjs";
import { recordJob } from "../src/jobs/history.mjs";

describe("quota hard-circuit history", () => {
  it("survives force-stop style job record", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-qhc-"));
    const cfg = { paths: { configDir: tmp } };
    const collector = createReceiptCollector();
    const job = {
      id: "job-force-stop-1",
      goal: "test",
      status: "cancelled",
      receiptCollector: collector,
    };
    recordHardBlock(job, {
      cfg: { quota: { maxHardBlocksPerJob: 1 } },
      collector,
    });
    ensureQuotaHardCircuitOnJob(job);
    assert.equal(job.quotaHardCircuit.tripped, true);

    const { slim, path: fp } = await recordJob(cfg, job);
    assert.equal(slim.quotaHardCircuit.tripped, true);
    assert.equal(slim.receiptMetrics.quotaHardCircuit.tripped, true);
    const disk = JSON.parse(fs.readFileSync(fp, "utf8"));
    assert.equal(disk.quotaHardCircuit.tripped, true);
  });

  it("synthesizes circuit from hardBlocks alone", () => {
    const job = {
      quotaEscalate: { softWarns: 0, hardBlocks: 3, escalatedFromSoft: 0 },
    };
    ensureQuotaHardCircuitOnJob(job);
    assert.equal(job.quotaHardCircuit.tripped, true);
    assert.equal(job.quotaHardCircuit.synthesized, true);
  });
});
