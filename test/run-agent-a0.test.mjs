import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAgentRequest,
  runAgent,
} from "../src/agent/run-agent.mjs";

describe("A0 channel-invariant runAgent", () => {
  it("normalizeAgentRequest treats goal/message/userMessage as same", () => {
    const a = normalizeAgentRequest({ goal: "  hello  " });
    const b = normalizeAgentRequest({ message: "hello" });
    const c = normalizeAgentRequest({ userMessage: "hello" });
    assert.equal(a.userMessage, "hello");
    assert.equal(b.userMessage, "hello");
    assert.equal(c.userMessage, "hello");
  });

  it("channel is metadata only — same goal yields same loop fields across channels", () => {
    const channels = ["cli", "telegram", "webchat", "tui", "discord"];
    const norms = channels.map((channel) =>
      normalizeAgentRequest({
        goal: "list files in /tmp",
        channel,
        cfg: { agent: { model: "test-model" } },
        chatSessionId: "sess-1",
      })
    );
    for (const n of norms) {
      assert.equal(n.userMessage, "list files in /tmp");
      assert.equal(n.chatSessionId, "sess-1");
      assert.equal(n.cfg.agent.model, "test-model");
      assert.equal(n.stream, false);
      assert.equal(typeof n.onEvent, "function");
    }
    assert.deepEqual(
      norms.map((n) => n.channel),
      channels
    );
  });

  it("empty goal returns ok:false without throwing", async () => {
    const out = await runAgent({ goal: "   ", channel: "cli" });
    assert.equal(out.ok, false);
    assert.equal(out.error, "empty_goal");
  });

  it("sessionId aliases chatSessionId", () => {
    const n = normalizeAgentRequest({ goal: "x", sessionId: "abc" });
    assert.equal(n.chatSessionId, "abc");
  });
});
