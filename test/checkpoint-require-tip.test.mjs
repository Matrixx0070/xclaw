import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRequireToolHashTip } from "../src/jobs/checkpoint-require-tip.mjs";
import { verifyCheckpointToolHash } from "../src/jobs/checkpoint-hash-verify.mjs";

describe("lab requireToolHashTip", () => {
  it("defaults on for lab/strict/prod", () => {
    assert.equal(shouldRequireToolHashTip({ profile: "lab" }), true);
    assert.equal(shouldRequireToolHashTip({ profile: "strict" }), true);
    assert.equal(shouldRequireToolHashTip({ profile: "prod" }), true);
    assert.equal(shouldRequireToolHashTip({ profile: "dev" }), false);
  });

  it("opts override cfg", () => {
    assert.equal(shouldRequireToolHashTip({ profile: "lab" }, { requireToolHashTip: false }), false);
    assert.equal(shouldRequireToolHashTip({ profile: "prod" }, { requireToolHashTip: true }), true);
  });

  it("lab resume fails missing tip", () => {
    const requireTip = shouldRequireToolHashTip({ profile: "lab" });
    const r = verifyCheckpointToolHash(
      { toolTrace: [{ name: "bash", result: "x" }] },
      { requireTip }
    );
    assert.equal(r.ok, false);
  });
});
