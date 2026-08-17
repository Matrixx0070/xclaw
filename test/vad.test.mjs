import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pcmRms,
  pcmToWav,
  vadConfig,
  analyzePcmFrames,
  probeVad,
  calibrateNoiseFloor,
} from "../src/voice/vad.mjs";

describe("VAD", () => {
  it("pcmRms silence is zero", () => {
    assert.equal(pcmRms(Buffer.alloc(320)), 0);
  });

  it("pcmRms detects tone", () => {
    const buf = Buffer.alloc(320);
    for (let i = 0; i < 160; i++) buf.writeInt16LE(10000, i * 2);
    assert.ok(pcmRms(buf) > 1000);
  });

  it("pcmToWav header", () => {
    const wav = pcmToWav(Buffer.alloc(320), 16000);
    assert.equal(wav.toString("utf8", 0, 4), "RIFF");
    assert.equal(wav.length, 44 + 320);
  });

  it("hysteresis close < open", () => {
    const c = vadConfig({}, { threshold: 1000 });
    assert.ok(c.closeThreshold < c.openThreshold);
  });

  it("analyzePcmFrames endpoints after silence", () => {
    const c = vadConfig({}, { threshold: 500, frameMs: 30, silenceMs: 90, hangoverFrames: 1 });
    const frameBytes = Math.floor((16000 * 30) / 1000) * 2;
    const frames = [];
    // 5 speech frames
    for (let i = 0; i < 5; i++) {
      const b = Buffer.alloc(frameBytes);
      for (let j = 0; j < frameBytes / 2; j++) b.writeInt16LE(8000, j * 2);
      frames.push(b);
    }
    // 5 silence frames
    for (let i = 0; i < 5; i++) frames.push(Buffer.alloc(frameBytes));
    const pcm = Buffer.concat(frames);
    const a = analyzePcmFrames(pcm, c);
    assert.equal(a.seenSpeech, true);
    assert.ok(a.endpointIndex != null && a.endpointIndex >= 0);
  });

  it("probeVad reports engine", () => {
    const p = probeVad({});
    assert.equal(p.engine, "energy-rms-hysteresis");
    assert.ok(p.silenceMs > 0);
  });

  it("calibrateNoiseFloor from quiet leading frames", () => {
    const frameBytes = Math.floor((16000 * 30) / 1000) * 2;
    const frames = [];
    for (let i = 0; i < 15; i++) {
      const b = Buffer.alloc(frameBytes);
      for (let j = 0; j < frameBytes / 2; j++) b.writeInt16LE(50, j * 2); // low noise
      frames.push(b);
    }
    const cal = calibrateNoiseFloor(Buffer.concat(frames), vadConfig({}));
    assert.equal(cal.ok, true);
    assert.ok(cal.openThreshold > cal.noiseFloor);
    assert.ok(cal.closeThreshold < cal.openThreshold);
  });
});
