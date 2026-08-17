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
    assert.equal(matchWakePhrase("hey xclaw").hit, true);
    assert.equal(matchWakePhrase("Okay XClaw, list files").hit, true);
    assert.equal(matchWakePhrase("xclaw").hit, true);
    assert.equal(matchWakePhrase("hey claw").hit, true);
  });

  it("rejects non-wake speech", () => {
    assert.equal(matchWakePhrase("list files in tmp").hit, false);
    assert.equal(matchWakePhrase("").hit, false);
  });

  it("wavRmsEnergy zero on empty", () => {
    assert.equal(wavRmsEnergy(Buffer.alloc(0)), 0);
  });

  it("wavRmsEnergy on synthetic silence", () => {
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    const data = Buffer.alloc(1600);
    const buf = Buffer.concat([header, data]);
    assert.equal(wavRmsEnergy(buf), 0);
  });

  it("wakeConfig defaults", () => {
    const c = wakeConfig({});
    assert.ok(c.phrases.includes("hey xclaw"));
    assert.ok(c.energyThreshold > 0);
    assert.equal(c.enabled, true);
  });

  it("probeWakeStack returns structure", async () => {
    const s = await probeWakeStack({});
    assert.ok(Array.isArray(s.phrases));
    assert.ok("arecord" in s);
    assert.ok("stt" in s);
    assert.ok("openWakeWord" in s);
    assert.ok("readyForW1" in s);
  });

  it("DEFAULT_WAKE_PHRASES non-empty", () => {
    assert.ok(DEFAULT_WAKE_PHRASES.length >= 3);
  });
});
