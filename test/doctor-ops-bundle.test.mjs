import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushDoctorOpsBundle } from "../src/cli/doctor-ops-bundle.mjs";

describe("doctor ops bundle", () => {
  it("emits killSwitch and receipt/stop/smoke ids", async () => {
    const checks = [];
    await pushDoctorOpsBundle((id) => checks.push(id), { seats: { enabled: false } });
    assert.ok(checks.includes("security.killSwitch") || checks.includes("ops.receipt_metrics"));
    assert.ok(checks.includes("gateway.stopRoute"));
    assert.ok(checks.includes("ops.smoke_compare"));
  });
});
