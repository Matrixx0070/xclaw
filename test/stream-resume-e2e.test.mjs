/**
 * Integration: start stream → disconnect → resume-live / replay-only.
 *
 * Server side: StreamEventLog + createProducer + attachWriterToLog
 * Client side: createResumingStreamClient against a tiny HTTP server
 *              that speaks the same resume protocol as the gateway.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  resolveStreamResume,
  createProducer,
  attachWriterToLog,
  getStreamLog,
  deleteStreamLog,
  listStreamLogs,
} from "../src/gateway/stream-resume.mjs";
import { createResumingStreamClient } from "../src/client/stream-resume-client.mjs";

// ─── Server-side protocol harness (mirrors gateway streamAgentRun modes) ───

function mockReq(url = "/agent/run/stream", headers = {}) {
  return { url, headers };
}

function collectPush() {
  const events = [];
  const push = (name, payload) => {
    events.push({ event: name, ...payload });
    return true;
  };
  return { events, push };
}

describe("e2e server: resume-live + replay-only", () => {
  it("new → produce → disconnect → resume-live gets gap + live", () => {
    const body = { message: "hello" };
    const r1 = resolveStreamResume(mockReq(), body, { prefix: "agent" });
    assert.equal(r1.mode, "new");
    const log = r1.log;
    const streamId = r1.streamId;

    const primary = collectPush();
    const produce = createProducer(log, primary.push);

    produce("lifecycle", { type: "lifecycle", phase: "start", streamId });
    produce("tool", { type: "tool", name: "xclaw_bash" });
    const afterTwo = log.events[log.events.length - 1].id;

    // Client "disconnects": primary stops reading; log stays live
    assert.equal(log.status, "live");

    // Second client resumes from after first event
    const firstId = log.events[0].id;
    const r2 = resolveStreamResume(
      mockReq("/agent/run/stream", { "last-event-id": firstId }),
      { streamId, resume: true, lastEventId: firstId },
      { prefix: "agent" }
    );
    assert.equal(r2.mode, "resume-live");
    assert.equal(r2.replay.length, 1);
    assert.equal(r2.replay[0].event, "tool");

    const secondary = collectPush();
    const { replayed, unsubscribe } = attachWriterToLog(log, {
      push: secondary.push,
      lastEventId: firstId,
      live: true,
    });
    assert.equal(replayed, 1);
    assert.equal(secondary.events[0].name, "xclaw_bash");
    assert.equal(secondary.events[0].resumed, true);

    // Live fan-out: new event reaches secondary
    produce("result", { type: "result", ok: true, text: "done" });
    assert.ok(secondary.events.some((e) => e.event === "result" || e.type === "result"));

    unsubscribe();
    log.markEnded("ended");
    deleteStreamLog(streamId);
  });

  it("ended log → replay-only returns gap then closes", () => {
    const r1 = resolveStreamResume(mockReq(), { message: "x" }, { prefix: "swarm" });
    const log = r1.log;
    const streamId = r1.streamId;
    const produce = createProducer(log, () => true);

    const a = produce("lifecycle", { phase: "start" });
    produce("task", { phase: "task_done" });
    produce("result", { ok: true });
    log.markEnded("ended");

    const r2 = resolveStreamResume(
      mockReq(),
      { streamId, resume: true, lastEventId: a.id },
      { prefix: "swarm" }
    );
    assert.equal(r2.mode, "replay-only");
    assert.equal(r2.replay.length, 2);
    assert.equal(r2.replay[0].event, "task");
    assert.equal(r2.replay[1].event, "result");

    const out = collectPush();
    const { replayed, unsubscribe } = attachWriterToLog(log, {
      push: out.push,
      lastEventId: a.id,
      live: false,
    });
    assert.equal(replayed, 2);
    assert.ok(out.events.every((e) => e.resumed === true));
    unsubscribe();
    deleteStreamLog(streamId);
  });

  it("unknown streamId → missing", () => {
    const r = resolveStreamResume(
      mockReq(),
      { streamId: "agent_does_not_exist", resume: true },
      { prefix: "agent" }
    );
    assert.equal(r.mode, "missing");
    assert.equal(r.replay.length, 0);
  });
});

// ─── HTTP e2e: tiny resume-aware server + createResumingStreamClient ───────

function startResumeTestServer() {
  /** @type {Map<string, import('../src/gateway/stream-resume.mjs').StreamEventLog>} */
  const sessions = new Map();

  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/agent/run/stream")) {
      res.writeHead(404);
      res.end();
      return;
    }

    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      body = {};
    }

    const resume = resolveStreamResume(req, body, { prefix: "agent" });
    const accept = String(req.headers.accept || "");
    const ndjson = /ndjson|jsonl/i.test(accept);
    res.writeHead(200, {
      "Content-Type": ndjson
        ? "application/x-ndjson"
        : "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    let idSeq = 0;
    const write = (event, payload) => {
      idSeq += 1;
      const id = payload.id || `${resume.streamId}:${idSeq}`;
      const row = { event, id, ...payload };
      if (ndjson) {
        res.write(JSON.stringify(row) + "\n");
      } else {
        res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(row)}\n\n`);
      }
    };

    if (resume.mode === "missing") {
      write("error", {
        code: "stream_not_found",
        error: `Unknown streamId: ${resume.streamId}`,
        streamId: resume.streamId,
        ok: false,
      });
      res.end();
      return;
    }

    if (resume.mode === "replay-only") {
      for (const e of resume.replay) {
        write(e.event, { ...e.payload, resumed: true, streamId: resume.streamId });
      }
      write("result", {
        ok: true,
        resumed: true,
        streamId: resume.streamId,
        status: resume.log.status,
      });
      res.end();
      return;
    }

    if (resume.mode === "resume-live") {
      for (const e of resume.replay) {
        write(e.event, { ...e.payload, resumed: true, streamId: resume.streamId });
      }
      write("lifecycle", {
        phase: "resume",
        streamId: resume.streamId,
        status: "live",
      });
      // Stay open briefly then end when log ends
      const unsub = resume.log.subscribe((entry) => {
        write(entry.event, { ...entry.payload, streamId: resume.streamId });
      });
      const check = setInterval(() => {
        if (resume.log.status !== "live") {
          clearInterval(check);
          unsub();
          write("result", {
            ok: true,
            streamId: resume.streamId,
            status: resume.log.status,
          });
          res.end();
        }
      }, 50);
      req.on("close", () => {
        clearInterval(check);
        unsub();
      });
      return;
    }

    // new
    const log = resume.log;
    sessions.set(resume.streamId, log);
    write("lifecycle", {
      phase: "start",
      streamId: resume.streamId,
      type: "lifecycle",
    });
    // Simulate work then finish
    setTimeout(() => {
      const e1 = log.append("tool", {
        type: "tool",
        name: "xclaw_bash",
        streamId: resume.streamId,
      });
      write("tool", { ...e1.payload, id: e1.id });
      const e2 = log.append("result", {
        type: "result",
        ok: true,
        text: "ok",
        streamId: resume.streamId,
      });
      write("result", { ...e2.payload, id: e2.id });
      log.markEnded("ended");
      res.end();
    }, 30);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        sessions,
        close: () =>
          new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("e2e HTTP client resume", () => {
  /** @type {Awaited<ReturnType<typeof startResumeTestServer>>} */
  let svc;

  before(async () => {
    svc = await startResumeTestServer();
  });

  after(async () => {
    // cleanup any leftover logs
    for (const s of listStreamLogs()) {
      try {
        deleteStreamLog(s.streamId);
      } catch {
        /* */
      }
    }
    await svc.close();
  });

  it("full run learns streamId and ends cleanly", async () => {
    const events = [];
    const client = createResumingStreamClient({
      kind: "agent",
      baseUrl: svc.baseUrl,
      body: { message: "hi" },
      format: "ndjson",
      maxAttempts: 2,
      maxResumeCycles: 1,
      telemetryLog: false,
      onEvent: (e) => events.push(e),
    });
    await client.start();
    assert.ok(client.getStreamId()?.startsWith("agent_"));
    assert.ok(client.getLastEventId());
    assert.ok(events.some((e) => e.event === "lifecycle"));
    assert.ok(events.some((e) => e.event === "result"));
    assert.equal(client.getStatus(), "ended");
  });

  it("replay-only after run finished", async () => {
    // First run to seed a finished log
    const seed = createResumingStreamClient({
      kind: "agent",
      baseUrl: svc.baseUrl,
      body: { message: "seed" },
      format: "ndjson",
      telemetryLog: false,
      onEvent: () => {},
    });
    await seed.start();
    const streamId = seed.getStreamId();
    const lastId = seed.getLastEventId();
    assert.ok(streamId);
    // Wait a tick so server markEnded is visible
    await new Promise((r) => setTimeout(r, 50));

    const log = getStreamLog(streamId);
    // May still be in registry with ended status
    if (log) assert.ok(["ended", "aborted", "live"].includes(log.status));

    const events = [];
    const resume = createResumingStreamClient({
      kind: "agent",
      baseUrl: svc.baseUrl,
      streamId,
      lastEventId: null, // full replay
      body: {},
      format: "ndjson",
      telemetryLog: false,
      maxAttempts: 1,
      onEvent: (e) => events.push(e),
    });
    await resume.start();
    assert.ok(
      events.some((e) => e.event === "result" || e.resumed),
      `events=${JSON.stringify(events).slice(0, 200)}`
    );
  });

  it("stream_not_found protocol returns error event", async () => {
    const res = await fetch(`${svc.baseUrl}/agent/run/stream`, {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        "Content-Type": "application/json",
        "Last-Event-ID": "agent_never_registered:1",
      },
      body: JSON.stringify({
        streamId: "agent_never_registered",
        resume: true,
        lastEventId: "agent_never_registered:1",
      }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /stream_not_found/);
    assert.match(text, /agent_never_registered/);

    // Client classification of the same payload
    const { resumeErrorFromEvent } = await import("../src/client/stream-resume-client.mjs");
    const row = JSON.parse(text.trim().split("\n")[0]);
    const err = resumeErrorFromEvent(row);
    assert.ok(err);
    assert.equal(err.code, "STREAM_NOT_FOUND");
    assert.equal(err.retryable, false);
  });
});
