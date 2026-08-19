import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { doctorCanaryCost } from "../src/cli/doctor-canary-cost.mjs";
import { stampCostBlock } from "../src/agent/cost-receipt.mjs";

describe("doctor canary cost", () => {
  it("reports cost blocks and canary totals", async () => {
    const job = { evidence: [], receipt: {} };
    stampCostBlock(job, { reason: "max_usd" });
    const d = await doctorCanaryCost({ profile: "lab" }, job);
    assert.ok(d.costBlocks >= 1);
    assert.ok(d.metrics.includes("xclaw_canary_ungrounded_total"));
    assert.equal(typeof d.ok, "boolean");
  });
});
