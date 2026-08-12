/**
 * Phase 7.1 — mocked provider 429 + Retry-After integration
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createProvider } from "../src/agent/provider.mjs";

function startMockProvider(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}/v1` });
    });
  });
}

describe("provider retry with Retry-After", () => {
  it("retries 429 then succeeds", async () => {
    let hits = 0;
    const mock = await startMockProvider((req, res) => {
      hits++;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (hits < 2) {
          res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "0" });
          res.end(JSON.stringify({ error: { message: "rate limited" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        );
      });
    });

    try {
      const provider = createProvider({
        apiKey: "test",
        baseUrl: mock.baseUrl,
        model: "test-model",
        retry: { retries: 3, baseMs: 1, maxDelayMs: 50, strategy: "none", retryAfterJitterRatio: 0, log: false },
      });
      const out = await provider.chat({
        messages: [{ role: "user", content: "hello" }],
      });
      assert.equal(out.message.content, "hi");
      assert.ok(hits >= 2);
    } finally {
      mock.server.close();
    }
  });

  it("fails fast on 400", async () => {
    const mock = await startMockProvider((req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "bad request" } }));
    });
    try {
      const provider = createProvider({
        apiKey: "test",
        baseUrl: mock.baseUrl,
        model: "test-model",
        retry: { retries: 3, baseMs: 1, strategy: "none", log: false },
      });
      await assert.rejects(
        () => provider.chat({ messages: [{ role: "user", content: "x" }] }),
        /400/
      );
    } finally {
      mock.server.close();
    }
  });
});
