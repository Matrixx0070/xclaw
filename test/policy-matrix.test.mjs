import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matrixDecision, buildProdSecurityOverlay } from "../src/security/policy-matrix.mjs";

describe("policy matrix", () => {
  it("prod only auto safe", () => {
    assert.equal(matrixDecision("file_read", "prod").auto, true);
    assert.equal(matrixDecision("bash", "prod").auto, false);
  });
  it("lab auto all", () => {
    assert.equal(matrixDecision("bash", "lab").auto, true);
  });
  it("overlay lists", () => {
    const o = buildProdSecurityOverlay();
    assert.ok(o.safeAuto.includes("file_read"));
    assert.ok(o.requireApproval.includes("bash"));
  });
});
