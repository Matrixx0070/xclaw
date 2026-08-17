import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldStreamVoiceReply } from "../src/voice/stream-reply.mjs";

describe("stream voice reply policy", () => {
  it("streams short conversational agent turns", () => {
    assert.equal(shouldStreamVoiceReply("what is two plus two", "agent"), true);
    assert.equal(shouldStreamVoiceReply("explain gravity briefly", "agent"), true);
  });

  it("does not stream tool-heavy goals", () => {
    assert.equal(shouldStreamVoiceReply("run the tests", "agent"), false);
    assert.equal(shouldStreamVoiceReply("write file /tmp/x", "agent"), false);
    assert.equal(shouldStreamVoiceReply("browse example.com", "agent"), false);
  });

  it("skips casual and command modes", () => {
    assert.equal(shouldStreamVoiceReply("hello", "casual"), false);
    assert.equal(shouldStreamVoiceReply("stop talking", "command"), false);
  });
});
