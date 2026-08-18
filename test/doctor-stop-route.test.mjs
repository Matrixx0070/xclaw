import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pushStopRouteChecks, stopRouteMounted } from "../src/cli/doctor-stop-route.mjs";

describe("doctor gateway.stopRoute", () => {
  it("detects mount markers", () => {
    assert.equal(stopRouteMounted("handleStopAll(req, res)"), true);
    assert.equal(stopRouteMounted("nope"), false);
  });

  it("pushes gateway.stopRoute check", async () => {
    const checks = [];
    await pushStopRouteChecks((id, status, message, extra) =>
      checks.push({ id, status, extra })
    );
    assert.equal(checks[0].id, "gateway.stopRoute");
    assert.equal(checks[0].extra.helperOk, true);
  });
});
