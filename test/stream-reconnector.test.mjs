import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createStreamReconnector,
  parseSSEBlock,
  sleepMs,
  reconnectDelayMs,
} from "../src/utils/sse-reconnect.mjs";

describe("parseSSEBlock", () => {
  it("parses id event data", () => {
    const b = parseSSEBlock("id: 7\nevent: tool\ndata: {\"x\":1}\n");
    assert.equal(b.id, "7");
    assert.equal(b.event, "tool");
    assert.equal(b.data, '{"x":1}');
  });
  it("skips comments", () => {
    const b = parseSSEBlock(": ping\n");
    assert.equal(b.event, "message");
    assert.equal(b.data, "");
  });
});

describe("sleepMs", () => {
  it("resolves after delay", async () => {
    const t0 = Date.now();
    await sleepMs(20);
    assert.ok(Date.now() - t0 >= 15);
  });
  it("aborts early", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error("stop")), 5);
    await assert.rejects(() => sleepMs(5000, ac.signal), /stop|abort/i);
  });
});

describe("createStreamReconnector", () => {
  it("consumes NDJSON and tracks lastEventId", async () => {
    const lines = [
      JSON.stringify({ event: "lifecycle", id: "1", phase: "start" }),
      JSON.stringify({ event: "ping", id: "2", at: 1 }),
      JSON.stringify({ event: "result", id: "3", ok: true, text: "hi" }),
      JSON.stringify({ event: "done", id: "4", ok: true }),
      "",
    ].join("\n");

    const events = [];
    const statuses = [];
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });

    const r = createStreamReconnector({
      url: "http://example.test/agent/run/stream",
      method: "POST",
      body: { message: "hi" },
      format: "ndjson",
      heartbeatMs: 60_000,
      maxAttempts: 1,
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        }),
    });

    await r.start();
    assert.equal(r.getLastEventId(), "4");
    assert.ok(events.some((e) => e.event === "lifecycle"));
    assert.ok(events.some((e) => e.event === "result" && e.text === "hi"));
    assert.ok(!events.some((e) => e.event === "ping")); // pings filtered
    assert.ok(statuses.includes("live") || statuses.includes("ended"));
  });

  it("consumes SSE blocks", async () => {
    const payload =
      "id: a\nevent: lifecycle\ndata: {\"phase\":\"start\"}\n\n" +
      ": ping\n\n" +
      "id: b\nevent: result\ndata: {\"ok\":true,\"text\":\"done\"}\n\n";

    const events = [];
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });

    const r = createStreamReconnector({
      url: "http://example.test/agent/run/stream",
      format: "sse",
      maxAttempts: 1,
      onEvent: (e) => events.push(e),
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    });

    await r.start();
    assert.equal(r.getLastEventId(), "b");
    assert.ok(events.some((e) => e.event === "lifecycle"));
    assert.ok(events.some((e) => e.event === "result"));
  });

  it("retries with backoff then succeeds", async () => {
    let calls = 0;
    const events = [];
    const statuses = [];

    const r = createStreamReconnector({
      url: "http://example.test/x",
      format: "ndjson",
      baseMs: 5,
      maxMs: 20,
      strategy: "none",
      maxAttempts: 5,
      heartbeatMs: 60_000,
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) {
          const err = new Error("network");
          err.code = "TRANSIENT";
          throw err;
        }
        const body = new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ event: "result", id: "9", ok: true }) + "\n"
              )
            );
            c.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      },
    });

    await r.start();
    assert.ok(calls >= 3);
    assert.equal(r.getLastEventId(), "9");
    assert.ok(statuses.includes("backoff") || statuses.some((s) => s === "reconnecting" || s === "connecting"));
  });

  it("sends Last-Event-ID on resume", async () => {
    let seenHeaders = null;
    let seenUrl = null;
    const r = createStreamReconnector({
      url: "http://example.test/stream",
      format: "ndjson",
      lastEventId: "42",
      maxAttempts: 1,
      body: { message: "x" },
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenHeaders = init.headers;
        const body = new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ event: "result", id: "43", ok: true }) + "\n"
              )
            );
            c.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      },
    });
    await r.start();
    assert.match(seenUrl, /lastEventId=42/);
    assert.equal(seenHeaders["Last-Event-ID"], "42");
    assert.equal(r.getLastEventId(), "43");
  });

  it("heartbeat timeout triggers reconnect", async () => {
    let calls = 0;
    const errors = [];
    const r = createStreamReconnector({
      url: "http://example.test/stream",
      format: "ndjson",
      baseMs: 5,
      maxMs: 15,
      strategy: "none",
      maxAttempts: 3,
      heartbeatMs: 60_000,
      onError: (e) => errors.push(e),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error("heartbeat_timeout after 50ms silence");
          err.code = "HEARTBEAT_TIMEOUT";
          throw err;
        }
        const body = new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ event: "result", id: "1", ok: true }) + "\n"
              )
            );
            c.close();
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      },
    });

    await r.start();
    assert.ok(calls >= 2, `expected retry after timeout, calls=${calls}`);
    assert.ok(errors.some((e) => e.code === "HEARTBEAT_TIMEOUT"));
    assert.equal(r.getLastEventId(), "1");
  });

});

describe("reconnectDelayMs still works", () => {
  it("caps delay", () => {
    for (let i = 0; i < 15; i++) {
      const d = reconnectDelayMs(i, { baseMs: 10, maxMs: 50, strategy: "none" });
      assert.ok(d <= 50);
    }
  });
});
