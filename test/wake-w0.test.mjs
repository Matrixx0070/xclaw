import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchWakePhrase,
  wavRmsEnergy,
  wakeConfig,
  DEFAULT_WAKE_PHRASES,
  probeWakeStack,
} from "../src/voice/wake/index.mjs";

describe("wake W0", () => {
  it("matches default phrases", () => {
    assert.equal(matchWakePhrase("hey xclaw are you there").hit, true);
    assert.equal(matchWakePhrase("Okay XClaw").hit, true);
    assert.equal(matchWakePhrase("list files please").hit, false);
  });

  it("fuzzy hey claw", () => {
    assert.equal(matchWakePhrase("hey claw").hit, true);
  });

  it("wakeConfig phrases", () => {
    const c = wakeConfig({ voice: { wake: { phrases: ["computer"] } } });
    assert.deepEqual(c.phrases, ["computer"]);
  });

  it("wavRmsEnergy silent-ish buffer", () => {
    const buf = Buffer.alloc(1000);
    assert.equal(wavRmsEnergy(buf), 0);
  });

  it("wavRmsEnergy with samples", () => {
    const buf = Buffer.alloc(44 + 200);
    buf.write("RIFF", 0);
    for (let i = 0; i < 100; i++) buf.writeInt16LE(1000, 44 + i * 2);
    assert.ok(wavRmsEnergy(buf) > 0);
  });

  it("probeWakeStack returns structure", async () => {
    const s = await probeWakeStack({});
    assert.ok(Array.isArray(s.phrases));
    assert.ok("arecord" in s);
    assert.ok("stt" in s);
    assert.ok("openWakeWord" in s);
    assert.equal(typeof s.readyForW1, "boolean");
  });

  it("default phrase list includes hey xclaw", () => {
    assert.ok(DEFAULT_WAKE_PHRASES.includes("hey xclaw"));
  });
});
