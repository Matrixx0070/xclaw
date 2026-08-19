import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runHallucinationCanary } from "../src/agent/hallucination-canary.mjs";

describe("hallucination canary", () => {
  it("flags ungrounded write claim without tools", () => {
    const r = runHallucinationCanary({
      text: "I wrote the file successfully to disk.",
      toolTrace: [],
    });
    assert.equal(r.ok, false);
    assert.ok(r.ungrounded.length >= 1);
  });
  it("passes when tool evidence present", () => {
    const r = runHallucinationCanary({
      text: "I wrote the file successfully.",
      toolTrace: [{ name: "xclaw_file_write", status: "ok" }],
    });
    assert.equal(r.ok, true);
  });
});
