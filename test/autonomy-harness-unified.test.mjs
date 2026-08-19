import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAutonomyHarness } from "../src/eval/autonomy-harness.mjs";

describe("autonomy harness unified", () => {
  it("runs offline harness with autonomy cases", async () => {
    const r = await runAutonomyHarness({ offline: true });
    assert.ok(r.caseCount >= 1, "expected autonomy cases");
    assert.ok(r.gate);
    assert.equal(typeof r.ok, "boolean");
  });
});
