import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyVoiceIntent,
  voiceCommandsHelp,
  VOICE_COMMANDS,
} from "../src/voice/commands.mjs";
import { createEntente } from "../src/voice/entente.mjs";

describe("voice commands", () => {
  it("catalog has core kinds", () => {
    const kinds = new Set(VOICE_COMMANDS.map((c) => c.kind));
    for (const k of [
      "stop_talking",
      "cancel_job",
      "status",
      "help",
      "repeat",
      "allow_talking",
    ]) {
      assert.ok(kinds.has(k), k);
    }
  });

  it("classifies natural phrases", () => {
    assert.equal(classifyVoiceIntent("please stop talking").kind, "stop_talking");
    assert.equal(classifyVoiceIntent("cancel that job").kind, "cancel_job");
    assert.equal(classifyVoiceIntent("keep going").kind, "keep_going");
    assert.equal(classifyVoiceIntent("what is your status").kind, "status");
    assert.equal(classifyVoiceIntent("say that again").kind, "repeat");
  });

  it("classifies slash commands", () => {
    assert.equal(classifyVoiceIntent("/mute").kind, "stop_talking");
    assert.equal(classifyVoiceIntent("/cancel").kind, "cancel_job");
    assert.equal(classifyVoiceIntent("/status").kind, "status");
    assert.equal(classifyVoiceIntent("/repeat").kind, "repeat");
  });

  it("utterance is default", () => {
    assert.equal(classifyVoiceIntent("list files in /tmp").kind, "utterance");
  });

  it("entente stop does not cancel jobs", () => {
    const e = createEntente();
    e.jobs.start({ kind: "tool", label: "test" });
    const inv = e.assertBargeInDoesNotCancelJobs();
    assert.equal(inv.ok, true);
    const r = e.onUserText("shut up");
    assert.equal(r.intent.kind, "stop_talking");
    assert.equal(e.jobs.listActive().length, 1);
  });

  it("help text is non-empty", () => {
    assert.ok(voiceCommandsHelp().length > 40);
  });

  it("repeat uses lastSpoken", () => {
    const e = createEntente();
    e.setLastSpoken("Hello world");
    const r = e.onUserText("/repeat");
    assert.equal(r.intent.kind, "repeat");
    assert.match(r.reply, /Hello world/);
  });
});
