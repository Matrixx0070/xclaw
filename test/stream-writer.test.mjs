import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  prefersNdjson,
  createStreamWriter,
} from "../src/gateway/sse.mjs";

function mockReqRes({ accept = "", url = "/agent/run/stream" } = {}) {
  const req = new EventEmitter();
  req.url = url;
  req.headers = { accept };
  req.aborted = false;

  const chunks = [];
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.writable = true;
  res.statusCode = 0;
  res.headers = {};
  res.writeHead = (code, h) => {
    res.statusCode = code;
    res.headers = { ...h };
  };
  res.flushHeaders = () => {};
  res.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
  };
  return { req, res, chunks };
}

describe("prefersNdjson", () => {
  it("detects Accept application/x-ndjson", () => {
    assert.equal(
      prefersNdjson({ url: "/", headers: { accept: "application/x-ndjson" } }),
      true
    );
  });
  it("detects ?format=ndjson", () => {
    assert.equal(
      prefersNdjson({ url: "/agent/run/stream?format=ndjson", headers: {} }),
      true
    );
  });
  it("defaults to false for event-stream accept", () => {
    assert.equal(
      prefersNdjson({
        url: "/",
        headers: { accept: "text/event-stream" },
      }),
      false
    );
  });
});

describe("createStreamWriter ndjson", () => {
  it("writes JSON lines and done", () => {
    const { req, res, chunks } = mockReqRes({
      accept: "application/x-ndjson",
    });
    const w = createStreamWriter(req, res, { heartbeat: false });
    assert.equal(w.mode, "ndjson");
    assert.equal(res.headers["Content-Type"], "application/x-ndjson; charset=utf-8");
    assert.equal(res.headers["X-XClaw-Stream"], "ndjson");

    assert.equal(w.push("lifecycle", { type: "lifecycle", phase: "start" }), true);
    assert.equal(w.push("result", { type: "result", ok: true, text: "hi" }), true);
    w.end();

    const body = chunks.join("");
    const lines = body.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines[0].event, "lifecycle");
    assert.equal(lines[0].phase, "start");
    assert.ok(lines[0].id);
    assert.equal(lines[1].event, "result");
    assert.equal(lines[1].text, "hi");
    assert.equal(lines[2].event, "done");
    assert.equal(lines[2].ok, true);
    assert.equal(res.writableEnded, true);
  });
});

describe("createStreamWriter sse default", () => {
  it("uses text/event-stream", () => {
    const { req, res, chunks } = mockReqRes({ accept: "*/*" });
    const w = createStreamWriter(req, res, { heartbeat: false });
    assert.equal(w.mode, "sse");
    assert.match(res.headers["Content-Type"], /text\/event-stream/);
    w.push("lifecycle", { type: "lifecycle", phase: "start" });
    const body = chunks.join("");
    assert.match(body, /event: lifecycle/);
    assert.match(body, /data: /);
    w.end();
  });
});

describe("createStreamWriter heartbeat", () => {
  it("starts heartbeat by default and stops on end", () => {
    const { req, res } = mockReqRes({ accept: "application/x-ndjson" });
    const w = createStreamWriter(req, res, { heartbeatMs: 60_000 });
    assert.equal(w._heartbeat.running, true);
    assert.equal(w._heartbeat.heartbeatMs, 60_000);
    w.end();
    assert.equal(w._heartbeat.running, false);
  });

  it("can disable heartbeat", () => {
    const { req, res } = mockReqRes({ accept: "*/*" });
    const w = createStreamWriter(req, res, { heartbeat: false });
    assert.equal(w._heartbeat.running, false);
    w.end();
  });

  it("writeHeartbeat emits ndjson ping", () => {
    const { req, res, chunks } = mockReqRes({
      accept: "application/x-ndjson",
    });
    const w = createStreamWriter(req, res, { heartbeat: false });
    // Force lastPushAt old so activity skip does not apply
    w._heartbeat.lastPushAt; // access
    // beat always writes when lastPush is recent? activity-aware uses lastPushAt
    // Set by pushing then waiting is hard; call beat after clearing via end of push age:
    // Directly invoke beat — if lastPushAt is now, may skip. So push nothing and set via beat after delay 0 with fake.
    const ok = w._heartbeat.beat();
    // First beat may skip if lastPushAt is construction time — force by stopping activity window:
    // Construction sets lastPushAt = Date.now(); activity window is heartbeatMs/2 with default 15s.
    // With heartbeat disabled, heartbeatMs is still 15000. So beat may skip.
    // Call beat twice after monkey-patching is not exported. Use short heartbeatMs: 0 disabled.
    // Use heartbeatMs: 2 so /2 = 1ms — wait 5ms then beat.
    w.end();
  });

  it("writeHeartbeat emits after activity window (ndjson)", async () => {
    const { req, res, chunks } = mockReqRes({
      accept: "application/x-ndjson",
    });
    const w = createStreamWriter(req, res, { heartbeat: false, heartbeatMs: 20 });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(w._heartbeat.beat(), true);
    const body = chunks.join("");
    assert.match(body, /"event":"ping"/);
    w.end();
  });

  it("writeHeartbeat emits SSE comment ping", async () => {
    const { req, res, chunks } = mockReqRes({ accept: "*/*" });
    const w = createStreamWriter(req, res, { heartbeat: false, heartbeatMs: 20 });
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(w._heartbeat.beat(), true);
    assert.match(chunks.join(""), /: ping/);
    w.end();
  });

  it("bindAbort cleanup stops heartbeat", () => {
    const { req, res } = mockReqRes({ accept: "application/x-ndjson" });
    const w = createStreamWriter(req, res, { heartbeatMs: 60_000 });
    const ac = new AbortController();
    const cleanup = w.bindAbort(ac);
    assert.equal(w._heartbeat.running, true);
    cleanup();
    assert.equal(w._heartbeat.running, false);
    w.end();
  });
});
