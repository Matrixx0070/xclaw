import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { probeOpusDecode, decodeOpusToWav } from "../src/voice/opus-decode.mjs";

describe("opus decode O1", () => {
  it("probe returns structure", async () => {
    const p = await probeOpusDecode();
    assert.ok("opusscript" in p);
    assert.ok("ffmpeg" in p);
    assert.ok("ready" in p);
  });

  it("empty packets fail gracefully", async () => {
    const r = await decodeOpusToWav([], { mode: "packets" });
    assert.equal(r.ok, false);
  });
});
