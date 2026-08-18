/**
 * Regression: spawn "whisper-cli" ENOENT must NOT count as stt.ok.
 *
 * Bug: /whisper/i matched the binary name inside "spawn whisper-cli ENOENT",
 * so missing STT was reported ready and readyForW1 could be true falsely.
 * Also guards probeLocalVoiceStack ↔ probeWakeStack recursion.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeWhisperCli,
  probeLocalVoiceStack,
} from "../src/voice/providers/local.mjs";
import { probeWakeStack } from "../src/voice/wake/index.mjs";

describe("whisper-cli ENOENT regression", () => {
  it("looksLikeWhisperCli rejects spawn ENOENT text", () => {
    assert.equal(
      looksLikeWhisperCli({
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: "spawn whisper-cli ENOENT",
        errorCode: "ENOENT",
      }),
      false
    );
    assert.equal(
      looksLikeWhisperCli({
        code: 127,
        stdout: Buffer.alloc(0),
        stderr: "spawn whisper-cli ENOENT",
        errorCode: null,
      }),
      false
    );
    assert.equal(
      looksLikeWhisperCli({
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: "spawn whisper-cli ENOENT",
      }),
      false
    );
  });

  it("looksLikeWhisperCli accepts real help output", () => {
    assert.equal(
      looksLikeWhisperCli({
        code: 0,
        stdout: Buffer.from("whisper.cpp usage:\n  -m model -f file\n"),
        stderr: "",
      }),
      true
    );
    assert.equal(
      looksLikeWhisperCli({
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: "usage: whisper-cli --model base -f audio.wav\n",
      }),
      true
    );
  });

  it("looksLikeWhisperCli does not treat bare /whisper/ match as success", () => {
    assert.equal(
      looksLikeWhisperCli({
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: "spawn whisper-cli ENOENT",
      }),
      false
    );
  });

  it("probeLocalVoiceStack reports stt.ok false when whisper-cli missing", async () => {
    const prev = process.env.XCLAW_WHISPER_BIN;
    process.env.XCLAW_WHISPER_BIN = "whisper-cli-definitely-missing-xclaw-test";
    try {
      const v = await probeLocalVoiceStack({
        voice: { _probeSkipWake: true, whisperBin: "whisper-cli-definitely-missing-xclaw-test" },
      });
      assert.equal(v.stt.ok, false, `expected stt.ok false, got ${JSON.stringify(v.stt)}`);
      assert.match(String(v.stt.error || ""), /not found|ENOENT|whisper/i);
    } finally {
      if (prev === undefined) delete process.env.XCLAW_WHISPER_BIN;
      else process.env.XCLAW_WHISPER_BIN = prev;
    }
  });

  it("probeWakeStack does not mark readyForW1 on missing STT alone with no arecord", async () => {
    const w = await probeWakeStack({
      voice: {
        whisperBin: "whisper-cli-definitely-missing-xclaw-test",
      },
    });
    assert.equal(w.stt.ok, false);
    if (!w.arecord.ok) {
      assert.equal(w.readyForW1, false);
    }
  });

  it("probeLocalVoiceStack with skipWake returns quickly (no recursion hang)", async () => {
    const t0 = Date.now();
    const v = await probeLocalVoiceStack({
      voice: {
        _probeSkipWake: true,
        whisperBin: "whisper-cli-definitely-missing-xclaw-test",
      },
    });
    const ms = Date.now() - t0;
    assert.ok(ms < 15_000, `probe took ${ms}ms — possible recursion`);
    assert.equal(v.wake, undefined);
    assert.equal(v.stt.ok, false);
  });
});
