import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry, fetchJsonWithRetry } from "../src/utils/fetch-retry.mjs";

describe("fetchWithRetry", () => {
  let originalFetch;
  before(() => {
    originalFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries 503 then succeeds", async () => {
    let n = 0;
    globalThis.fetch = async () => {
      n += 1;
      if (n < 3) {
        return new Response("busy", { status: 503, statusText: "Service Unavailable" });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const res = await fetchWithRetry("https://example.test/api", {
      retries: 3,
      baseMs: 5,
      maxDelayMs: 20,
    });
    assert.equal(res.status, 200);
    assert.equal(n, 3);
  });

  it("does not retry 404", async () => {
    let n = 0;
    globalThis.fetch = async () => {
      n += 1;
      return new Response("nope", { status: 404 });
    };
    const res = await fetchWithRetry("https://example.test/missing", {
      retries: 3,
      baseMs: 5,
      maxDelayMs: 20,
    });
    assert.equal(res.status, 404);
    assert.equal(n, 1);
  });

  it("fetchJsonWithRetry parses body", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const body = await fetchJsonWithRetry("https://example.test/models", {
      retries: 1,
      baseMs: 5,
    });
    assert.deepEqual(body, { models: [] });
  });
});
