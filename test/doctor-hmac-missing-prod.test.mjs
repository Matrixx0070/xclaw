import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushStopHmacChecks } from "../src/cli/doctor-stop-hmac.mjs";
import { pushStopHealthChecks } from "../src/cli/doctor-stop-health.mjs";
import { stopAuthReadiness } from "../src/gateway/stop-health.mjs";

describe("HMAC missing in prod", () => {
  it("health.hmac is missing when required", () => {
    const r = stopAuthReadiness({
      profile: "prod",
      gateway: { token: "s", stopHmac: true },
    });
    assert.equal(r.hmac, "missing");
    assert.equal(r.ready, false);
  });

  it("ops.stop_health errors", async () => {
    const checks = [];
    await pushStopHealthChecks((id, status) => checks.push({ id, status }), {
      profile: "prod",
      gateway: { token: "s", stopHmac: true },
    });
    assert.equal(checks[0].status, "error");
  });

  it("gateway.stopHmac errors when requireStop", () => {
    const checks = [];
    pushStopHmacChecks((id, status) => checks.push({ id, status }), {
      profile: "prod",
      readiness: { requireStop: true },
    });
    assert.equal(checks[0].status, "error");
  });
});
