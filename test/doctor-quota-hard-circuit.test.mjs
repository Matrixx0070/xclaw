import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeHardCircuits,
  pushQuotaHardCircuitChecks,
} from "../src/cli/doctor-quota-hard-circuit.mjs";

describe("doctor ops.quota_hard_circuit", () => {
  it("summarizes trip rate", () => {
    const s = summarizeHardCircuits([
      { quotaHardCircuit: { tripped: true, hardBlocks: 3 } },
      { quotaHardCircuit: { tripped: true, hardBlocks: 3 } },
      {},
    ]);
    assert.equal(s.tripped, 2);
    assert.ok(s.tripRate > 0.5);
    assert.equal(s.jobs, 3);
  });

  it("warns with empty job index", () => {
    const checks = [];
    pushQuotaHardCircuitChecks(
      (id, status) => checks.push({ id, status }),
      "/tmp/xclaw-no-jobs-dir-xyz"
    );
    assert.equal(checks[0].id, "ops.quota_hard_circuit");
    assert.equal(checks[0].status, "warn");
  });
});
