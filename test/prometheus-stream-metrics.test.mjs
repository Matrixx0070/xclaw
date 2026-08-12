import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resetTelemetry,
  recordStreamError,
  recordResumeEvent,
  renderStreamTelemetryPrometheus,
} from "../src/utils/stream-telemetry.mjs";
import {
  getOrCreateStreamLog,
  deleteStreamLog,
  newStreamId,
  renderStreamRegistryPrometheus,
} from "../src/gateway/stream-resume.mjs";
import { renderMetrics } from "../src/gateway/metrics.mjs";

describe("Prometheus stream metrics", () => {
  it("emits labeled error counters", () => {
    resetTelemetry();
    recordStreamError({
      kind: "webchat",
      code: "NETWORK",
      phase: "client",
      retryable: true,
      log: false,
    });
    const text = renderStreamTelemetryPrometheus();
    assert.match(text, /# TYPE xclaw_stream_errors_total counter/);
    assert.match(text, /xclaw_stream_errors_total\{[^}]*kind="webchat"/);
    assert.match(text, /xclaw_stream_errors_retryable_total\{kind="webchat"\} 1/);
  });

  it("emits stream registry gauges", () => {
    const id = newStreamId("t");
    const log = getOrCreateStreamLog(id);
    log.append("x", {});
    const text = renderStreamRegistryPrometheus();
    assert.match(text, /xclaw_stream_logs\{status="live"\} [1-9]/);
    assert.match(text, /xclaw_stream_log_events_buffered [1-9]/);
    deleteStreamLog(id);
  });

  it("renderMetrics includes stream sections", async () => {
    resetTelemetry();
    recordStreamError({
      kind: "swarm",
      code: "SERVER",
      phase: "client",
      retryable: true,
      log: false,
    });
    recordResumeEvent("resume_failed", { kind: "swarm", code: "MAX_RESUME_CYCLES", log: false });
    const text = await renderMetrics({ profile: "test", paths: {} });
    assert.match(text, /xclaw_info\{/);
    assert.match(text, /xclaw_stream_errors_total/);
    assert.match(text, /xclaw_stream_resume_events_total/);
    assert.match(text, /xclaw_stream_logs\{status=/);
  });
});
