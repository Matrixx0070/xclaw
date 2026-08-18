import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordLastDrain, getLastDrain } from "../src/gateway/last-drain.mjs";
import { pushKillSwitchChecks } from "../src/cli/doctor-kill-switch.mjs";

describe("doctor last drain", () => {
  it("records and reports lastDrain", async () => {
    recordLastDrain({ sessionsKilled: 2, wsClosed: 1, sseClosed: 3 });
    assert.equal(getLastDrain().sessionsKilled, 2);
    const checks = [];
    await pushKillSwitchChecks((id, status, message, extra) => checks.push({ id, extra }));
    assert.ok(checks.some((c) => c.id === "security.killSwitch.lastDrain"));
    assert.ok(checks[0].extra.lastDrain);
  });
});
