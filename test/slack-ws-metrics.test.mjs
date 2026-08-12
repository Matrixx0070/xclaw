import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  slackWsMetricsReset,
  slackWsNoteConnectStart,
  slackWsNoteConnected,
  slackWsNoteFrame,
  slackWsNoteReconnect,
  slackWsNoteHandleMessage,
  getSlackWsMetrics,
  renderSlackWsPrometheus,
} from "../src/channels/slack/ws-metrics.mjs";

describe("Slack WS latency metrics", () => {
  beforeEach(() => slackWsMetricsReset());

  it("tracks connect latency", async () => {
    slackWsNoteConnectStart();
    await new Promise((r) => setTimeout(r, 15));
    slackWsNoteConnected();
    const m = getSlackWsMetrics();
    assert.ok(m.lastConnectLatencyMs >= 10);
    assert.equal(m.connectLatency.count, 1);
  });

  it("tracks inter-frame gaps", async () => {
    slackWsNoteConnected();
    slackWsNoteFrame();
    await new Promise((r) => setTimeout(r, 12));
    slackWsNoteFrame();
    const m = getSlackWsMetrics();
    assert.ok(m.frames >= 2);
    assert.ok(m.interFrame.count >= 1);
    assert.ok(m.interFrame.avg >= 5);
  });

  it("tracks handleMessage and reconnects", () => {
    slackWsNoteHandleMessage(42);
    slackWsNoteHandleMessage(100);
    slackWsNoteReconnect("heartbeat_timeout");
    const m = getSlackWsMetrics();
    assert.equal(m.handleMessage.count, 2);
    assert.equal(m.handleMessage.p50, 42);
    assert.equal(m.reconnects, 1);
    assert.equal(m.heartbeatTimeouts, 1);
  });

  it("renders prometheus text", () => {
    slackWsNoteConnectStart();
    slackWsNoteConnected();
    slackWsNoteFrame();
    const text = renderSlackWsPrometheus();
    assert.match(text, /xclaw_slack_ws_frames_total/);
    assert.match(text, /xclaw_slack_ws_reconnects_total/);
  });
});
