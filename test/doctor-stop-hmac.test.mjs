import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushStopHmacChecks } from "../src/cli/doctor-stop-hmac.mjs";

describe("doctor gateway.stopHmac", () => {
  it("errors when required without secret", () => {
    const checks = [];
    pushStopHmacChecks((id, status) => checks.push({ id, status }), {
      gateway: { stopHmac: true },
    });
    assert.equal(checks[0].id, "gateway.stopHmac");
    assert.equal(checks[0].status, "error");
  });

  it("ok when secret set", () => {
    const checks = [];
    pushStopHmacChecks((id, status) => checks.push(status), {
      gateway: { stopHmacSecret: "s" },
    });
    assert.equal(checks[0], "ok");
  });

  it("warns in prod without secret", () => {
    const checks = [];
    pushStopHmacChecks((id, status) => checks.push(status), { profile: "prod" });
    assert.equal(checks[0], "warn");
  });
});
