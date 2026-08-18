import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { singlePortChecks } from "../src/cli/doctor-single-port.mjs";

describe("doctor singlePort stop paths", () => {
  it("includes gateway.singlePort.stop", () => {
    const checks = singlePortChecks({ gateway: { port: 18790 }, computer: { port: 4243 } });
    const stop = checks.find((c) => c.id === "gateway.singlePort.stop");
    assert.ok(stop);
    assert.equal(stop.status, "ok");
  });
});
