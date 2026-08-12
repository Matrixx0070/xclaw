import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import {
  toAnthropicMessages,
  fromAnthropicMessage,
  createAnthropicMessagesProvider,
} from "../src/providers/anthropic-messages.mjs";
import { evictMessages } from "../src/tokens/kv-eviction.mjs";

const SIG = "EqQBCgIYAhIM1o+sig-material==";

const thinkingCfg = { agent: { reasoning: { enabled: true, maxTokens: 5000 } } };

/** SSE frames for: thinking block (delta + signature) → text block. */
function sseBody() {
  const evts = [
    { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "let me think" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " harder" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: SIG } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ];
  return evts.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

describe("anthropic thinking-block capture", () => {
  it("(a) SSE stream captures thinking + signature, text unpolluted", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sseBody());
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const p = createAnthropicMessagesProvider({
        apiKey: "sk-ant-api-test",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        cfg: thinkingCfg,
      });
      const out = await p.chatStream({ messages: [{ role: "user", content: "hi" }] });
      assert.equal(out.message.content, "hello");
      assert.equal(out.message.reasoning, "let me think harder");
      assert.equal(out.message.thinkingBlocks.length, 1);
      assert.deepEqual(out.message.thinkingBlocks[0], {
        type: "thinking",
        thinking: "let me think harder",
        signature: SIG,
      });
    } finally {
      server.close();
    }
  });

  it("(b) non-stream response captures thinking blocks verbatim", () => {
    const assistant = fromAnthropicMessage({
      content: [
        { type: "thinking", thinking: "hmm", signature: SIG },
        { type: "text", text: "answer" },
      ],
    });
    assert.equal(assistant.content, "answer");
    assert.equal(assistant.reasoning, "hmm");
    assert.deepEqual(assistant.thinkingBlocks, [
      { type: "thinking", thinking: "hmm", signature: SIG },
    ]);
  });

  it("(e) redacted_thinking round-trips verbatim", () => {
    const assistant = fromAnthropicMessage({
      content: [
        { type: "redacted_thinking", data: "OPAQUE_BYTES==" },
        { type: "text", text: "x" },
      ],
    });
    assert.deepEqual(assistant.thinkingBlocks, [
      { type: "redacted_thinking", data: "OPAQUE_BYTES==" },
    ]);
    const { messages } = toAnthropicMessages(
      [{ role: "assistant", content: "x", thinkingBlocks: assistant.thinkingBlocks }],
      { includeThinking: true }
    );
    assert.deepEqual(messages[0].content[0], { type: "redacted_thinking", data: "OPAQUE_BYTES==" });
  });
});

describe("anthropic thinking-block replay on the wire", () => {
  const history = [
    { role: "user", content: "do the thing" },
    {
      role: "assistant",
      content: null,
      reasoning: "plan the call",
      thinkingBlocks: [{ type: "thinking", thinking: "plan the call", signature: SIG }],
      tool_calls: [
        { id: "toolu_1", type: "function", function: { name: "t", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "toolu_1", content: "result" },
  ];

  it("(c) thinking enabled → blocks emitted FIRST, signature intact, before tool_use", () => {
    const { messages } = toAnthropicMessages(history, { includeThinking: true });
    const assistant = messages.find((m) => m.role === "assistant");
    assert.equal(assistant.content[0].type, "thinking");
    assert.equal(assistant.content[0].signature, SIG);
    assert.equal(assistant.content[0].thinking, "plan the call");
    const toolIdx = assistant.content.findIndex((b) => b.type === "tool_use");
    assert.ok(toolIdx > 0, "tool_use present after thinking");
  });

  it("(d) thinking disabled → no thinking blocks on the wire (default)", () => {
    const { messages } = toAnthropicMessages(history);
    const assistant = messages.find((m) => m.role === "assistant");
    assert.ok(assistant.content.every((b) => b.type !== "thinking"));
  });

  it("(f) two-call mock: second request body carries the signed block", async () => {
    const captured = [];
    let call = 0;
    const server = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        captured.push(JSON.parse(data));
        call++;
        res.writeHead(200, { "content-type": "application/json" });
        if (call === 1) {
          res.end(
            JSON.stringify({
              content: [
                { type: "thinking", thinking: "plan", signature: SIG },
                { type: "tool_use", id: "toolu_9", name: "t", input: { a: 1 } },
              ],
              stop_reason: "tool_use",
              usage: { input_tokens: 1, output_tokens: 1 },
            })
          );
        } else {
          res.end(
            JSON.stringify({
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 1, output_tokens: 1 },
            })
          );
        }
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const p = createAnthropicMessagesProvider({
        apiKey: "sk-ant-api-test",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        cfg: thinkingCfg,
      });
      // Turn 1 — model thinks then calls a tool
      const msgs = [{ role: "user", content: "go" }];
      const r1 = await p.chat({ messages: msgs });
      assert.equal(r1.finishReason, "tool_calls");
      assert.equal(r1.message.thinkingBlocks[0].signature, SIG);
      // The loop pushes completion.message AS-IS (loop.mjs) then the tool result
      msgs.push(r1.message);
      msgs.push({ role: "tool", tool_call_id: "toolu_9", content: "tool says hi" });
      // Turn 2 — replay must include the signed thinking block
      const r2 = await p.chat({ messages: msgs });
      assert.equal(r2.message.content, "done");
      const wire = captured[1];
      const assistantMsg = wire.messages.find((m) => m.role === "assistant");
      assert.equal(assistantMsg.content[0].type, "thinking");
      assert.equal(assistantMsg.content[0].signature, SIG);
      assert.equal(
        assistantMsg.content.findIndex((b) => b.type === "tool_use") > 0,
        true
      );
    } finally {
      server.close();
    }
  });
});

describe("loop + eviction retain thinkingBlocks", () => {
  it("loop pushes completion.message by reference (tripwire)", () => {
    const src = fs.readFileSync(new URL("../src/agent/loop.mjs", import.meta.url), "utf8");
    assert.match(
      src,
      /const assistant = completion\.message;\s*\n\s*messages\.push\(assistant\);/,
      "loop must push the provider message object as-is so thinkingBlocks survive into history"
    );
  });

  it("evictMessages preserves thinkingBlocks on protected recent messages", () => {
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: "a",
        thinkingBlocks: [{ type: "thinking", thinking: "t", signature: SIG }],
      },
    ];
    const { messages: out } = evictMessages(messages, {
      enabled: true,
      policy: "hybrid",
      maxMessages: 40,
      protectRecent: 2,
    });
    const assistant = out.find((m) => m.role === "assistant");
    assert.deepEqual(assistant.thinkingBlocks, [
      { type: "thinking", thinking: "t", signature: SIG },
    ]);
  });
});
