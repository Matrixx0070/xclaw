import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autonomyCostCircuitCheck } from "../src/eval/autonomy-cost-circuit.mjs";

describe("autonomy cost\u2192circuit", () => {
  it("stamps circuit on hard cost deny", async () => {
    const r = await autonomyCostCircuitCheck();
    assert.equal(r.ok, true);
    assert.ok(r.circuit);
  });
});
