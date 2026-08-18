import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertStopChannel, assertLastDrainChannel } from "../src/eval/stop-channel-assert.mjs";

describe("autonomy stop channel assert", () => {
  it("accepts http|ws|sse only", () => {
    assert.equal(assertStopChannel("ws").ok, true);
    assert.equal(assertStopChannel("sse").ok, true);
    assert.equal(assertStopChannel("http").ok, true);
    assert.equal(assertStopChannel("mqtt").ok, false);
  });
  it("lastDrain null is skipped ok", () => {
    assert.equal(assertLastDrainChannel(null).ok, true);
    assert.equal(assertLastDrainChannel({ channel: "sse" }).ok, true);
  });
});
