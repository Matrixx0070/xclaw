import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { doctorAutonomySummary } from "../src/cli/doctor-autonomy.mjs";
import { isSingleGateway } from "../src/config/single-gateway.mjs";

describe("doctor autonomy", () => {
  it("summarizes autonomy health", async () => {
    const s = await doctorAutonomySummary({ profile: "lab" }, { toolCalls: 0 });
    assert.equal(typeof s.ok, "boolean");
    assert.ok(s.cost);
    assert.ok(s.canary);
    assert.ok(s.gate);
    assert.equal(s.singleGateway, true);
  });
  it("single gateway is default", () => {
    assert.equal(isSingleGateway({}), true);
    assert.equal(isSingleGateway({ cluster: { enabled: true } }), false);
  });
});
