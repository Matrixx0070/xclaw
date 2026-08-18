import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushStopAuthChecks } from "../src/cli/doctor-stop-auth.mjs";

describe("doctor gateway.stopAuth", () => {
  it("errors in prod without token", () => {
    const checks = [];
    pushStopAuthChecks((id, status) => checks.push({ id, status }), { profile: "prod" });
    assert.equal(checks[0].id, "gateway.stopAuth");
    assert.equal(checks[0].status, "error");
  });

  it("ok when token set", () => {
    const checks = [];
    pushStopAuthChecks((id, status) => checks.push(status), { gateway: { token: "s" } });
    assert.equal(checks[0], "ok");
  });
});
