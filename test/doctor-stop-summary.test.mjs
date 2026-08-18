import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStopSummary } from "../src/cli/doctor-stop-summary.mjs";

describe("doctor summary.stop", () => {
  it("includes fire-drill and lastDrain.channel", () => {
    const s = buildStopSummary([
      { id: "ops.stop_health", status: "ok", message: "ready" },
      {
        id: "security.killSwitch.lastDrain",
        status: "ok",
        message: "last",
        detail: { channel: "ws", authMethod: "hmac", sessionsKilled: 0 },
      },
      { id: "ops.stop_fire_drill", status: "ok", message: "passed" },
    ]);
    assert.equal(s.lastDrainChannel, "ws");
    assert.equal(s.lastDrainAuthMethod, "hmac");
    assert.equal(s.fireDrill.status, "ok");
  });
});
