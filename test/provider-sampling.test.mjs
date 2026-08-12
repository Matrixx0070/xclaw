import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createProvider } from "../src/agent/provider.mjs";
import { createAnthropicMessagesProvider } from "../src/providers/anthropic-messages.mjs";

/** Mock OpenAI-compat server capturing request bodies. */
function mockOpenAI() {
  const captured = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      captured.push(JSON.parse(data));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      );
    });
  });
  return { server, captured };
}

/** Mock Anthropic Messages server capturing request bodies. */
function mockAnthropic() {
  const captured = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      captured.push(JSON.parse(data));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      );
    });
  });
  return { server, captured };
}

describe("openai-compat sampling params", () => {
  let server, captured, port;
  before(async () => {
    ({ server, captured } = mockOpenAI());
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => server.close());

  const mk = (cfg = {}) =>
    createProvider({
      apiKey: "test-key",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "test-model",
      cfg,
      retry: { retries: 0 },
    });

  const msgs = [{ role: "user", content: "hi" }];

  it("default wire body unchanged: temperature 0.2, no reasoning fields", async () => {
    await mk().chat({ messages: msgs });
    const body = captured.at(-1);
    assert.equal(body.temperature, 0.2);
    assert.ok(!("reasoning_effort" in body));
  });

  it("cfg.agent.temperature honored", async () => {
    await mk({ agent: { temperature: 0.7 } }).chat({ messages: msgs });
    assert.equal(captured.at(-1).temperature, 0.7);
  });

  it("cfg.agent.temperature: null omits the field", async () => {
    await mk({ agent: { temperature: null } }).chat({ messages: msgs });
    assert.ok(!("temperature" in captured.at(-1)));
  });

  it("reasoning effort → reasoning_effort, temperature dropped", async () => {
    await mk({ agent: { reasoning: { effort: "high" } } }).chat({ messages: msgs });
    const body = captured.at(-1);
    assert.equal(body.reasoning_effort, "high");
    assert.ok(!("temperature" in body), "temperature omitted when reasoning active");
  });

  it("reasoning + explicit temperature keeps both", async () => {
    await mk({ agent: { temperature: 0.3, reasoning: { effort: "low" } } }).chat({
      messages: msgs,
    });
    const body = captured.at(-1);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.temperature, 0.3);
  });
});

describe("anthropic thinking params", () => {
  let server, captured, port;
  before(async () => {
    ({ server, captured } = mockAnthropic());
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => server.close());

  const mk = (cfg = {}) =>
    createAnthropicMessagesProvider({
      apiKey: "sk-ant-api-test",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "claude-sonnet-5",
      cfg,
      retry: { retries: 0 },
    });

  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ];

  it("default: no temperature, no thinking (wire unchanged)", async () => {
    await mk().chat({ messages: msgs });
    const body = captured.at(-1);
    assert.ok(!("temperature" in body));
    assert.ok(!("thinking" in body));
  });

  it("cfg.agent.temperature sent when configured", async () => {
    await mk({ agent: { temperature: 0.5 } }).chat({ messages: msgs });
    assert.equal(captured.at(-1).temperature, 0.5);
  });

  it("reasoning enabled → thinking block, temperature omitted, max_tokens grown", async () => {
    await mk({ agent: { temperature: 0.5, reasoning: { enabled: true } } }).chat({
      messages: msgs,
    });
    const body = captured.at(-1);
    assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 10000 });
    assert.ok(!("temperature" in body), "temperature must be omitted with thinking");
    assert.ok(
      body.max_tokens > 10000,
      `max_tokens (${body.max_tokens}) must exceed budget_tokens`
    );
  });

  it("effort maps to budget when maxTokens unset; maxTokens wins when set", async () => {
    await mk({ agent: { reasoning: { effort: "high" } } }).chat({ messages: msgs });
    assert.equal(captured.at(-1).thinking.budget_tokens, 20000);
    await mk({ agent: { reasoning: { effort: "high", maxTokens: 6000 } } }).chat({
      messages: msgs,
    });
    assert.equal(captured.at(-1).thinking.budget_tokens, 6000);
  });

  it("cache_control still applied alongside thinking (system block marked)", async () => {
    await mk({ agent: { reasoning: { enabled: true } } }).chat({ messages: msgs });
    const body = captured.at(-1);
    assert.ok(Array.isArray(body.system));
    assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
  });
});

describe("anthropic stream thinking tolerance", () => {
  it("thinking_delta accumulates into reasoning without polluting text", async () => {
    const frames = [
      `event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"pondering..."}}\n\n`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"sig=="}}\n\n`,
      `event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}\n\n`,
      `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n`,
    ];
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const f of frames) res.write(f);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address();
    try {
      const p = createAnthropicMessagesProvider({
        apiKey: "sk-ant-api-test",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: "claude-sonnet-5",
        retry: { retries: 0 },
      });
      const deltas = [];
      const out = await p.chatStream({
        messages: [{ role: "user", content: "hi" }],
        onDelta: (d) => deltas.push(d),
      });
      assert.equal(out.message.content, "answer");
      assert.equal(out.message.reasoning, "pondering...");
      assert.ok(deltas.some((d) => d.type === "thinking"));
      assert.ok(!out.message.content.includes("pondering"));
    } finally {
      server.close();
    }
  });
});
