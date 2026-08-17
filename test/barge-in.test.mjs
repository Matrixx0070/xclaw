import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSpeechPlane } from "../src/voice/speech-plane.mjs";
import { createEntente } from "../src/voice/entente.mjs";
import { playWavInterruptible } from "../src/voice/playback.mjs";

describe("barge-in handling", () => {
  it("advances epoch and clears playing", () => {
    const s = createSpeechPlane();
    const begin = s.beginSpeak("hello");
    assert.equal(begin.ok, true);
    assert.equal(s.isPlaying(), true);
    const r = s.bargeIn({ reason: "test" });
    assert.equal(r.jobsCancelled, false);
    assert.equal(s.isPlaying(), false);
    assert.equal(s.getEpoch(), begin.epoch + 1);
    assert.ok(typeof r.killPathMs === "number");
    assert.ok(r.killPathMs < 50, "kill path should be sub-50ms sync");
  });

  it("stopTalking suppresses further speak", () => {
    const s = createSpeechPlane();
    s.stopTalking();
    const b = s.beginSpeak("nope");
    assert.equal(b.ok, false);
    assert.equal(b.reason, "suppressed");
  });

  it("stale epoch rejected after barge-in", () => {
    const s = createSpeechPlane();
    const begin = s.beginSpeak("hi");
    s.bargeIn();
    const again = s.beginSpeak("late", { epoch: begin.epoch });
    assert.equal(again.ok, false);
  });

  it("registerStopper invoked on barge-in", () => {
    const s = createSpeechPlane();
    let stopped = false;
    s.registerStopper(() => {
      stopped = true;
    });
    s.beginSpeak("x");
    s.bargeIn();
    assert.equal(stopped, true);
  });

  it("entente barge-in does not cancel jobs", () => {
    const e = createEntente();
    e.jobs.start({ kind: "tool", label: "x" });
    e.onBargeIn();
    assert.equal(e.jobs.listActive().length, 1);
  });

  it("playWavInterruptible finishes on missing file without throw", async () => {
    const s = createSpeechPlane();
    const begin = s.beginSpeak("t");
    const r = await playWavInterruptible("/tmp/xclaw-no-such-audio-file.wav", {
      speech: s,
      epoch: begin.epoch,
    }).promise;
    assert.ok(r.ok === false || r.interrupted || r.error);
  });
});
