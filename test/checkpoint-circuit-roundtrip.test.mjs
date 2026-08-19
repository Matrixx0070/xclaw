import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveCheckpoint, loadCheckpoint } from "../src/jobs/checkpoint.mjs";
import { rehydrateReceiptFromCheckpoint } from "../src/jobs/checkpoint-receipt.mjs";

describe("checkpoint circuit round-trip", () => {
  it("persists quotaHardCircuit in slim", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xclaw-cp-"));
    const cfg = { paths: { configDir: tmp } };
    await saveCheckpoint(cfg, {
      id: "cp1",
      goal: "test",
      status: "running",
      turns: 2,
      quotaHardCircuit: { tripped: true, hardBlocks: 3 },
      quotaEscalate: { hardBlocks: 3 },
      receiptCollector: { quotaHardCircuit: { tripped: true } },
    });
    const loaded = await loadCheckpoint(cfg, "cp1");
    assert.equal(loaded.quotaHardCircuit.tripped, true);
    const job = { id: "j2" };
    rehydrateReceiptFromCheckpoint(job, loaded);
    assert.equal(job.quotaHardCircuit.tripped, true);
  });
});
