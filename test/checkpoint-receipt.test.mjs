import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rehydrateReceiptFromCheckpoint } from "../src/jobs/checkpoint.mjs";

describe("checkpoint receipt rehydrate", () => {
  it("restores quota fields", () => {
    const job = { id: "j1" };
    rehydrateReceiptFromCheckpoint(job, {
      quotaEscalate: { hardBlocks: 3 },
      quotaHardCircuit: { tripped: true },
    });
    assert.equal(job.quotaEscalate.hardBlocks, 3);
    assert.equal(job.quotaHardCircuit.tripped, true);
  });
});
