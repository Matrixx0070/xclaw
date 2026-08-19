import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stampCostHardBlock } from "../src/tokens/cost-hard-block.mjs";

describe("cost governor hard block stamp", () => {
  it("trips job on hard check", async () => {
    const job = { id: "j1" };
    await stampCostHardBlock(job, { hard: true, message: "cap" });
    assert.ok(job.quotaHardCircuit?.tripped || job.quotaHardCircuit?.reason);
  });
});
