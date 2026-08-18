import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { singlePortChecks, pushSinglePortChecks } from "../src/cli/doctor-single-port.mjs";

describe("doctor gateway.singlePort", () => {
  it("ok when proxy enabled by default", () => {
    const checks = singlePortChecks({ gateway: { port: 18790 }, computer: { port: 4243 } });
    const sp = checks.find((c) => c.id === "gateway.singlePort");
    assert.equal(sp.status, "ok");
    assert.match(sp.message, /proxy enabled/);
  });

  it("warn when proxy disabled", () => {
    const checks = singlePortChecks({
      gateway: { proxyComputer: false, port: 1 },
      computer: { port: 2 },
    });
    assert.equal(checks[0].status, "warn");
  });

  it("warn when ports collide", () => {
    const checks = singlePortChecks({ gateway: { port: 4243 }, computer: { port: 4243 } });
    const ports = checks.find((c) => c.id === "gateway.singlePort.ports");
    assert.equal(ports.status, "warn");
  });

  it("pushSinglePortChecks feeds push()", () => {
    const seen = [];
    pushSinglePortChecks((id, status, message) => seen.push({ id, status, message }), {
      gateway: { port: 9 },
      computer: { port: 8 },
    });
    assert.ok(seen.some((s) => s.id === "gateway.singlePort"));
  });
});
