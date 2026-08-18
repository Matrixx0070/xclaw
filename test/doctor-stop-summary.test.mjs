import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStopSummary, attachStopSummary } from "../src/cli/doctor-stop-summary.mjs";

describe("doctor stop JSON summary", () => {
  it("rolls up health + lastDrain", () => {
    const s = buildStopSummary([
      { id: "ops.stop_health", status: "ok", message: "ready", detail: { auth: "token", hmac: "configured" } },
      { id: "gateway.stopHmac", status: "ok", message: "HMAC configured" },
      { id: "security.killSwitch.lastDrain", status: "ok", message: "authMethod=hmac", detail: { authMethod: "hmac" } },
    ]);
    assert.equal(s.status, "ok");
    assert.equal(s.health.auth, "token");
    assert.equal(s.lastDrain.authMethod, "hmac");
  });

  it("errors if any child errors", () => {
    const s = buildStopSummary([
      { id: "ops.stop_health", status: "error", message: "missing" },
    ]);
    assert.equal(s.status, "error");
    const r = attachStopSummary({ checks: [{ id: "ops.stop_health", status: "error" }] });
    assert.equal(r.summary.stop.status, "error");
  });
});
