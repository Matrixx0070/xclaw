import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probeWebRtc } from "../src/voice/webrtc-session.mjs";

describe("webrtc R1", () => {
  it("probe returns structure", async () => {
    const p = await probeWebRtc();
    assert.ok("ok" in p);
    if (!p.ok) assert.ok(p.error);
    else assert.equal(p.engine, "werift");
  });
});
