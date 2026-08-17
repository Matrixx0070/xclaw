import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pcmRms, pcmToWav, vadConfig } from "../src/voice/vad.mjs";

describe("VAD endpointing helpers", () => {
  it("pcmRms silence is zero", () => {
    assert.equal(pcmRms(Buffer.alloc(320)), 0);
  });

  it("pcmRms detects tone", () => {
    const buf = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) buf.writeInt16LE(10000, i * 2);
    assert.ok(pcmRms(buf) > 1000);
  });

  it("pcmToWav header", () => {
    const pcm = Buffer.alloc(320);
    const wav = pcmToWav(pcm, 16000);
    assert.equal(wav.toString("utf8", 0, 4), "RIFF");
    assert.equal(wav.toString("utf8", 8, 12), "WAVE");
    assert.equal(wav.length, 44 + 320);
  });

  it("vadConfig defaults", () => {
    const c = vadConfig({});
    assert.equal(c.sampleRate, 16000);
    assert.ok(c.silenceMs >= 300);
    assert.ok(c.maxMs >= 3000);
  });
});
