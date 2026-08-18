import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  doctorColdStartCheck,
  doctorFlakeBudgetCheck,
} from "../src/cli/doctor-perf-checks.mjs";

describe("doctor perf checks", () => {
  it("cold-start ok under budget", () => {
    const c = doctorColdStartCheck({}, { totalMs: 180, healthStatus: 200 });
    assert.equal(c.status, "ok");
    assert.equal(c.id, "ops.cold_start");
  });

  it("cold-start fail over budget", () => {
    const c = doctorColdStartCheck({ ops: { coldStartMaxMs: 100 } }, { totalMs: 500 });
    assert.equal(c.status, "fail");
  });

  it("cold-start warn when missing", () => {
    const c = doctorColdStartCheck({}, null);
    assert.equal(c.status, "warn");
  });

  it("flake budget fail on high rate", () => {
    const c = doctorFlakeBudgetCheck({}, { totalCases: 100, flakeCount: 10 });
    assert.equal(c.status, "fail");
  });

  it("flake budget ok under 2%", () => {
    const c = doctorFlakeBudgetCheck({}, { totalCases: 100, flakeCount: 1 });
    assert.equal(c.status, "ok");
  });
});
