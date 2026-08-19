import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareStopChannel } from "../src/eval/autonomy-smoke-compare.mjs";

describe("autonomy compare stop channel", () => {
  it("rejects unknown channel", () => {
    const r = compareStopChannel({ lastDrain: { channel: "mqtt" } });
    assert.equal(r.ok, false);
  });
  it("accepts sse", () => {
    const r = compareStopChannel({ lastDrain: { channel: "sse" } });
    assert.equal(r.ok, true);
  });
  it("skips when missing", () => {
    assert.equal(compareStopChannel({}).ok, true);
  });
});
