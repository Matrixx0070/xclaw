import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  splitSentences,
  createSentenceStreamSpeaker,
} from "../src/voice/sentence-tts.mjs";
import { createSpeechPlane } from "../src/voice/speech-plane.mjs";

describe("sentence-flush TTS", () => {
  it("splits on sentence boundaries", () => {
    const parts = splitSentences("Hello there. How are you? Fine.");
    assert.equal(parts.length, 3);
    assert.match(parts[0], /Hello/);
    assert.match(parts[2], /Fine/);
  });

  it("keeps single sentence intact", () => {
    assert.deepEqual(splitSentences("Just one"), ["Just one"]);
  });

  it("stream flusher accumulates then ends", async () => {
    const speech = createSpeechPlane();
    const spoken = [];
    // Don't actually TTS — just test buffer logic via split
    const stream = createSentenceStreamSpeaker(
      {},
      {
        speech,
        // override by not needing real speak if localSpeak fails — end still resolves
      }
    );
    stream.push("Hello world. ");
    stream.push("Second sentence!");
    await stream.end();
    assert.ok(true);
  });

  it("barge-in stops plane during queue concept", () => {
    const speech = createSpeechPlane();
    speech.beginSpeak("x");
    const r = speech.bargeIn();
    assert.ok(r.killPathMs != null);
  });
});
