import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushStopHealthChecks } from "../src/cli/doctor-stop-health.mjs";

describe("doctor ops.stop_health", () => {
  it("ok when token + hmac set", async () => {
    const checks = [];
    await pushStopHealthChecks((id, status) => checks.push({ id, status }), {
      gateway: { token: "s", stopHmacSecret: "h" },
    });
    assert.equal(checks[0].id, "ops.stop_health");
    assert.equal(checks[0].status, "ok");
  });

  it("errors in prod without token", async () => {
    const checks = [];
    await pushStopHealthChecks((id, status) => checks.push(status), {
      profile: "prod",
    });
    assert.equal(checks[0], "error");
  });
});
