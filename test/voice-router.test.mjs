import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { routeVoiceUtterance, casualReply } from "../src/voice/router.mjs";

describe("voice router", () => {
  it("routes commands", () => {
    assert.equal(routeVoiceUtterance("stop talking").mode, "command");
    assert.equal(routeVoiceUtterance("/cancel").mode, "command");
  });

  it("routes casual greetings", () => {
    assert.equal(routeVoiceUtterance("hello").mode, "casual");
    assert.equal(routeVoiceUtterance("thanks").mode, "casual");
  });

  it("routes agent tasks", () => {
    assert.equal(routeVoiceUtterance("list files in /tmp").mode, "agent");
    assert.equal(routeVoiceUtterance("run the tests please").mode, "agent");
  });

  it("casual replies are short", () => {
    assert.ok(casualReply("hello").length < 40);
    assert.match(casualReply("thank you"), /welcome/i);
  });
});
