import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordHardBlock,
  isHardBlockCircuitTripped,
  hardBlockCircuitMessage,
  guardToolAgainstHardCircuit,
} from "../src/agent/quota-hard-circuit.mjs";

describe("quota hard-block circuit", () => {
  it("trips after N hard blocks", () => {
    const job = {};
    const cfg = { quota: { maxHardBlocksPerJob: 2 } };
    assert.equal(recordHardBlock(job, { cfg }).tripped, false);
    const r = recordHardBlock(job, { cfg, code: "WORKSPACE_QUOTA_EXCEEDED" });
    assert.equal(r.tripped, true);
    assert.equal(isHardBlockCircuitTripped(job), true);
    assert.ok(hardBlockCircuitMessage(job).includes("QUOTA_HARD_CIRCUIT"));
    assert.equal(job.quotaEscalate.hardBlocks, 2);
    const g = guardToolAgainstHardCircuit(job);
    assert.equal(g.ok, false);
    assert.equal(g.reason, "QUOTA_HARD_CIRCUIT");
  });
});
