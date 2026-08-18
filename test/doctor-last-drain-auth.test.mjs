import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordLastDrain } from "../src/gateway/last-drain.mjs";
import { pushKillSwitchChecks } from "../src/cli/doctor-kill-switch.mjs";

describe("doctor lastDrain authMethod", () => {
  it("surfaces authMethod in lastDrain check", async () => {
    recordLastDrain({
      sessionsKilled: 1,
      wsClosed: 2,
      sseClosed: 0,
      authMethod: "hmac",
    });
    const checks = [];
    await pushKillSwitchChecks((id, status, msg) => checks.push({ id, status, msg }));
    const last = checks.find((c) => c.id === "security.killSwitch.lastDrain");
    assert.ok(last);
    assert.match(last.msg, /authMethod=hmac/);
  });
});
