import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordStreamError,
  recordResumeEvent,
  getCounter,
  resetTelemetry,
  listRecentTelemetry,
  renderStreamTelemetryPrometheus,
} from "../src/utils/stream-telemetry.mjs";
import {
  createResumingStreamClient,
} from "../src/client/stream-resume-client.mjs";

describe("stream-telemetry", () => {
  it("records error counters and recent log", () => {
    resetTelemetry();
    recordStreamError({
      kind: "agent",
      code: "STREAM_NOT_FOUND",
      message: "gone",
      streamId: "s1",
      retryable: false,
      phase: "server",
      log: false,
    });
    assert.equal(
      getCounter("xclaw_stream_errors_total", {
        kind: "agent",
        code: "STREAM_NOT_FOUND",
        phase: "server",
      }),
      1
    );
    assert.equal(
      getCounter("xclaw_stream_errors_fatal_total", { kind: "agent" }),
      1
    );
    const recent = listRecentTelemetry({ limit: 5 });
    assert.ok(recent.some((e) => e.code === "STREAM_NOT_FOUND"));
  });

  it("renders prometheus fragment", () => {
    resetTelemetry();
    recordStreamError({
      kind: "swarm",
      code: "NETWORK",
      retryable: true,
      phase: "client",
      log: false,
    });
    recordResumeEvent("resume_backoff", {
      kind: "swarm",
      delayMs: 10,
      log: false,
    });
    const text = renderStreamTelemetryPrometheus();
    assert.match(text, /xclaw_stream_errors_total/);
    assert.match(text, /kind="swarm"/);
    assert.match(text, /xclaw_stream_resume_events_total/);
  });
});

describe("client telemetry integration", () => {
  it("logs STREAM_NOT_FOUND via client", async () => {
    resetTelemetry();
    const client = createResumingStreamClient({
      kind: "agent",
      streamId: "missing",
      body: {},
      format: "ndjson",
      maxAttempts: 1,
      telemetryLog: false,
      fetchImpl: async () => {
        const body = new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  event: "error",
                  code: "stream_not_found",
                  error: "Unknown streamId: missing",
                  streamId: "missing",
                }) + "\n"
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
    await assert.rejects(() => client.start());
    assert.ok(
      getCounter("xclaw_stream_errors_total", {
        kind: "agent",
        code: "STREAM_NOT_FOUND",
        phase: "client",
      }) >= 1
    );
  });
});
