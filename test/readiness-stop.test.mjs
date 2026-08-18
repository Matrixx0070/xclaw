import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkReadiness } from "../src/gateway/readiness.mjs";

describe("/ready stop.ready", () => {
  it("lab is ready without token", async () => {
    const r = await checkReadiness({
      readiness: { requireComputer: false },
    });
    assert.equal(r.ready, true);
    assert.ok(r.body.checks.stop);
  });

  it("prod not ready without token", async () => {
    const r = await checkReadiness({
      profile: "prod",
      readiness: { requireComputer: false },
    });
    assert.equal(r.ready, false);
    assert.equal(r.status, 503);
    assert.equal(r.body.checks.stop.ok, false);
  });
});
