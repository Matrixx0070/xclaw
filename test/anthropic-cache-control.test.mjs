import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  toAnthropicMessages,
  capCacheBreakpoints,
  createAnthropicMessagesProvider,
} from "../src/providers/anthropic-messages.mjs";
import { OAUTH_ATTESTATION } from "../src/providers/anthropic-oauth-headers.mjs";

const block = (text, cache = false) =>
  cache ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text };

describe("toAnthropicMessages system handling", () => {
  it("string system stays flat text with no systemBlocks", () => {
    const out = toAnthropicMessages([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "hi" },
    ]);
    assert.equal(out.system, "You are helpful.");
    assert.equal(out.systemBlocks, null);
  });

  it("structured system preserves blocks + cache_control (no JSON.stringify blob)", () => {
    const out = toAnthropicMessages([
      {
        role: "system",
        content: [block("base", true), block("memory", true), block("dynamic")],
      },
      { role: "user", content: "hi" },
    ]);
    assert.ok(Array.isArray(out.systemBlocks));
    assert.equal(out.systemBlocks.length, 3);
    assert.deepEqual(out.systemBlocks[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(out.systemBlocks[1].cache_control, { type: "ephemeral" });
    assert.equal(out.systemBlocks[2].cache_control, undefined);
    // flattened text is the joined block texts, never a JSON blob
    assert.equal(out.system, "base\n\nmemory\n\ndynamic");
    assert.ok(!out.system.includes("{"), "system text must not be stringified JSON");
  });

  it("mixed string + structured system entries merge into blocks", () => {
    const out = toAnthropicMessages([
      { role: "system", content: "plain intro" },
      { role: "system", content: [block("cached tail", true)] },
      { role: "user", content: "hi" },
    ]);
    assert.ok(Array.isArray(out.systemBlocks));
    assert.equal(out.systemBlocks.length, 2);
    assert.equal(out.systemBlocks[0].text, "plain intro");
    assert.deepEqual(out.systemBlocks[1].cache_control, { type: "ephemeral" });
  });
});

describe("capCacheBreakpoints", () => {
  it("caps to 4 markers, keeping the last ones", () => {
    const blocks = [1, 2, 3, 4, 5, 6].map((i) => block(`b${i}`, true));
    const capped = capCacheBreakpoints(blocks);
    const marked = capped.filter((b) => b.cache_control).map((b) => b.text);
    assert.deepEqual(marked, ["b3", "b4", "b5", "b6"]);
    assert.equal(capped.length, 6, "no blocks dropped, only markers stripped");
  });

  it("leaves ≤4 markers untouched", () => {
    const blocks = [block("a", true), block("b"), block("c", true)];
    assert.deepEqual(capCacheBreakpoints(blocks), blocks);
  });
});

describe("anthropic provider wire format (mock server)", () => {
  let server;
  let port;
  let lastBody = null;

  before(async () => {
    server = http.createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        lastBody = JSON.parse(data);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "msg_test",
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 2 },
          })
        );
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });

  after(() => server.close());

  const mkProvider = (extra = {}) =>
    createAnthropicMessagesProvider({
      apiKey: "sk-ant-api-test",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "claude-sonnet-5",
      retry: { retries: 0 },
      ...extra,
    });

  it("plain-string system gains a single trailing cache_control block by default", async () => {
    await mkProvider().chat({
      messages: [
        { role: "system", content: "sys prompt" },
        { role: "user", content: "hi" },
      ],
    });
    assert.ok(Array.isArray(lastBody.system));
    assert.equal(lastBody.system.length, 1);
    assert.equal(lastBody.system[0].text, "sys prompt");
    assert.deepEqual(lastBody.system[0].cache_control, { type: "ephemeral" });
  });

  it("structured system blocks reach the wire with breakpoints intact", async () => {
    await mkProvider().chat({
      messages: [
        { role: "system", content: [block("base", true), block("skills", true), block("note")] },
        { role: "user", content: "hi" },
      ],
    });
    assert.equal(lastBody.system.length, 3);
    assert.deepEqual(lastBody.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(lastBody.system[1].cache_control, { type: "ephemeral" });
    assert.equal(lastBody.system[2].cache_control, undefined);
  });

  it(">4 breakpoints are capped on the wire", async () => {
    await mkProvider().chat({
      messages: [
        { role: "system", content: [1, 2, 3, 4, 5, 6].map((i) => block(`b${i}`, true)) },
        { role: "user", content: "hi" },
      ],
    });
    assert.equal(lastBody.system.filter((b) => b.cache_control).length, 4);
  });

  it("opt-out (cache:false) emits no cache_control anywhere", async () => {
    await mkProvider({ cache: false }).chat({
      messages: [
        { role: "system", content: [block("base", true)] },
        { role: "user", content: "hi" },
      ],
    });
    assert.ok(Array.isArray(lastBody.system));
    assert.equal(lastBody.system.filter((b) => b.cache_control).length, 0);
  });

  it("config opt-out (tokens.cacheBreakpoints.enabled=false) keeps plain string system", async () => {
    await mkProvider({ cfg: { tokens: { cacheBreakpoints: { enabled: false } } } }).chat({
      messages: [
        { role: "system", content: "sys prompt" },
        { role: "user", content: "hi" },
      ],
    });
    assert.equal(typeof lastBody.system, "string");
    assert.equal(lastBody.system, "sys prompt");
  });

  it("OAuth: attestation is the exact first system text, blocks preserved after it", async () => {
    await mkProvider({ apiKey: "sk-ant-oat01-test" }).chat({
      messages: [
        { role: "system", content: [block("base", true)] },
        { role: "user", content: "hi" },
      ],
    });
    assert.ok(Array.isArray(lastBody.system));
    assert.equal(lastBody.system[0].text, OAUTH_ATTESTATION);
    assert.equal(lastBody.system[1].text, "base");
    assert.deepEqual(lastBody.system[1].cache_control, { type: "ephemeral" });
  });

  it("no system message → no system field (api-key mode)", async () => {
    await mkProvider().chat({ messages: [{ role: "user", content: "hi" }] });
    assert.equal("system" in lastBody, false);
  });
});
