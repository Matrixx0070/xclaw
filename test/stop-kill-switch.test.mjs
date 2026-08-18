import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleStopAll, isStopPath } from "../src/gateway/stop-route.mjs";
import { pushKillSwitchChecks } from "../src/cli/doctor-kill-switch.mjs";
import { registerSession } from "../src/agent/session-control.mjs";

describe("stop kill-switch", () => {
  it("recognizes stop paths", () => {
    assert.equal(isStopPath("/stop"), true);
    assert.equal(isStopPath("/xclaw/stop"), true);
    assert.equal(isStopPath("/sessions/stop-all"), true);
    assert.equal(isStopPath("/other"), false);
  });

  it("handleStopAll drains sessions", async () => {
    registerSession("sess_stop_test", { label: "t" });
    const r = await handleStopAll({}, null, { cfg: {} });
    assert.equal(r.ok, true);
    assert.ok(r.killedSessions.includes("sess_stop_test"));
    assert.ok("ws" in r && "sse" in r);
  });

  it("doctor reports ws+sse capability", async () => {
    const checks = [];
    await pushKillSwitchChecks((id, status, message, extra) => checks.push({ id, status, extra }));
    assert.equal(checks[0].id, "security.killSwitch");
    assert.equal(checks[0].extra.closeSse, true);
  });
});
