import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAutonomySoak } from "../src/eval/autonomy-soak.mjs";

describe("autonomy soak", () => {
  it("runs multi-trial offline soak", async () => {
    const r = await runAutonomySoak({ trials: 2, offline: true });
    assert.equal(r.trials, 2);
    assert.equal(typeof r.flakeRate, "number");
    assert.equal(typeof r.ok, "boolean");
  });
});
