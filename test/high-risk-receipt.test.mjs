import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  guardHighRiskReceipt,
  toolRequiresReceipt,
} from "../src/agent/high-risk-receipt.mjs";

describe("high-risk receipt", () => {
  it("blocks bash in prod without evidence", () => {
    assert.equal(toolRequiresReceipt("xclaw_bash"), true);
    const r = guardHighRiskReceipt("xclaw_bash", {}, { profile: "prod" });
    assert.equal(r.ok, false);
    assert.equal(r.code, "RECEIPT_REQUIRED");
  });
  it("allows when evidence present", () => {
    const r = guardHighRiskReceipt(
      "xclaw_bash",
      { evidence: [{ type: "tool", name: "xclaw_bash" }] },
      { profile: "prod" }
    );
    assert.equal(r.ok, true);
  });
  it("lab mode soft-allows", () => {
    const r = guardHighRiskReceipt("xclaw_bash", {}, { profile: "lab" });
    assert.equal(r.ok, true);
  });
});
