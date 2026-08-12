import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePromLabels,
  isHighCardinalityLabelSet,
  incr,
  getCounter,
  resetTelemetry,
  recordStreamError,
  seriesCount,
  renderStreamTelemetryPrometheus,
  PROM_LABEL_DENYLIST,
} from "../src/utils/stream-telemetry.mjs";

describe("high-cardinality label guards", () => {
  it("sanitize drops streamId and message", () => {
    const s = sanitizePromLabels({
      kind: "agent",
      code: "STREAM_NOT_FOUND",
      phase: "client",
      streamId: "agent_abc_should_not_appear",
      message: "huge text",
      userId: "u-1",
    });
    assert.deepEqual(s, {
      kind: "agent",
      code: "STREAM_NOT_FOUND",
      phase: "client",
    });
  });

  it("maps unknown kind/code to other", () => {
    const s = sanitizePromLabels({
      kind: "custom-plugin-xyz",
      code: "WEIRD_NEW_CODE_123",
      phase: "edge",
    });
    assert.equal(s.kind, "other");
    assert.equal(s.code, "other");
    assert.equal(s.phase, "other");
  });

  it("isHighCardinalityLabelSet detects deny list", () => {
    assert.equal(isHighCardinalityLabelSet({ streamId: "x" }), true);
    assert.equal(isHighCardinalityLabelSet({ kind: "agent" }), false);
  });

  it("incr does not create series per streamId", () => {
    resetTelemetry();
    for (let i = 0; i < 50; i++) {
      // attacker-style: try to pass streamId via labels
      incr("xclaw_stream_errors_total", {
        kind: "agent",
        code: "NETWORK",
        phase: "client",
        streamId: `s_${i}`,
      });
    }
    // All should collapse to one series
    assert.equal(
      getCounter("xclaw_stream_errors_total", {
        kind: "agent",
        code: "NETWORK",
        phase: "client",
      }),
      50
    );
    assert.ok(seriesCount() <= 3, `seriesCount=${seriesCount()}`);
  });

  it("recordStreamError keeps ids in logs but not prom text", () => {
    resetTelemetry();
    recordStreamError({
      kind: "agent",
      code: "STREAM_NOT_FOUND",
      phase: "server",
      streamId: "agent_unique_99",
      lastEventId: "agent_unique_99:42",
      message: "Unknown streamId",
      retryable: false,
      log: false,
    });
    const prom = renderStreamTelemetryPrometheus();
    assert.doesNotMatch(prom, /agent_unique_99/);
    assert.match(prom, /kind="agent"/);
    assert.match(prom, /code="STREAM_NOT_FOUND"/);
    assert.match(prom, /xclaw_stream_metric_series/);
  });

  it("deny list includes common high-card tags", () => {
    for (const k of ["streamId", "userId", "requestId", "traceId"]) {
      assert.ok(PROM_LABEL_DENYLIST.includes(k), k);
    }
  });
});
