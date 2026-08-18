import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  probeOpusEncode,
  encodePcmToOpusPackets,
  wavToPcm,
} from "../src/voice/opus-encode.mjs";
import { pcmToWav } from "../src/voice/vad.mjs";

describe("opus encode O2", () => {
  it("probe structure", async () => {
    const p = await probeOpusEncode();
    assert.ok("ready" in p);
  });

  it("wavToPcm strips header", () => {
    const pcm = Buffer.alloc(640);
    const wav = pcmToWav(pcm, 16000);
    const raw = wavToPcm(wav);
    assert.equal(raw.length, 640);
  });

  it("encode without library fails gracefully", async () => {
    const pcm = Buffer.alloc(16000 * 2 * 0.1); // 100ms
    const r = await encodePcmToOpusPackets(pcm, { sampleRate: 16000 });
    // ok if library present, or structured error if not
    assert.ok(r.ok === true || r.error);
  });
});
