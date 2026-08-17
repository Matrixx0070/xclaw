import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordVoiceMetric,
  voiceMetricsSnapshot,
  resetVoiceMetrics,
} from "../src/voice/metrics.mjs";

describe("voice metrics", () => {
  it("records and snapshots", () => {
    resetVoiceMetrics();
    recordVoiceMetric("wake", { phrase: "hey xclaw" });
    recordVoiceMetric("vad", { durationMs: 800, speechMs: 400 });
    recordVoiceMetric("reply_stream", { firstAudioMs: 350 });
    recordVoiceMetric("barge_in", { killPathMs: 2 });
    const s = voiceMetricsSnapshot();
    assert.equal(s.counters.wakeHits, 1);
    assert.equal(s.counters.vadEndpoints, 1);
    assert.equal(s.latency.ttfaMs.n, 1);
    assert.equal(s.latency.ttfaMs.p50, 350);
    assert.equal(s.latency.bargeInKillMs.p50, 2);
  });

  it("reset clears", () => {
    resetVoiceMetrics();
    assert.equal(voiceMetricsSnapshot().samples, 0);
  });
});
