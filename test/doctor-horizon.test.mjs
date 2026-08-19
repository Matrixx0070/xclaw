import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { doctorHorizon } from "../src/cli/doctor-horizon.mjs";

describe("doctor horizon", () => {
  it("reports at least 3 horizon cases", async () => {
    const d = await doctorHorizon({});
    assert.ok(d.horizonCaseCount >= 3);
    assert.equal(d.ok, true);
  });
});
