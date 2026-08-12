/**
 * Slack Socket Mode WebSocket latency metrics (ring buffer).
 */
const MAX_SAMPLES = 200;

/** @type {object} */
const state = {
  frames: 0,
  reconnects: 0,
  heartbeatTimeouts: 0,
  lastFrameAt: null,
  connectedAt: null,
  lastConnectLatencyMs: null,
  connectLatencySamples: [],
  interFrameSamples: [],
  handleMessageSamples: [],
  lastError: null,
};

function pushSample(arr, value, max = MAX_SAMPLES) {
  if (value == null || Number.isNaN(value) || value < 0) return;
  arr.push(Number(value));
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(samples) {
  if (!samples.length) {
    return { count: 0, min: null, max: null, avg: null, p50: null, p95: null, p99: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round((sum / sorted.length) * 100) / 100,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

export function slackWsMetricsReset() {
  state.frames = 0;
  state.reconnects = 0;
  state.heartbeatTimeouts = 0;
  state.lastFrameAt = null;
  state.connectedAt = null;
  state.lastConnectLatencyMs = null;
  state.connectLatencySamples = [];
  state.interFrameSamples = [];
  state.handleMessageSamples = [];
  state.lastError = null;
}

export function slackWsNoteConnectStart() {
  state._connectStartedAt = Date.now();
}

export function slackWsNoteConnected() {
  const now = Date.now();
  state.connectedAt = now;
  if (state._connectStartedAt) {
    const ms = now - state._connectStartedAt;
    state.lastConnectLatencyMs = ms;
    pushSample(state.connectLatencySamples, ms);
  }
  state.lastFrameAt = now;
}

export function slackWsNoteFrame() {
  const now = Date.now();
  state.frames += 1;
  if (state.lastFrameAt != null) {
    pushSample(state.interFrameSamples, now - state.lastFrameAt);
  }
  state.lastFrameAt = now;
}

export function slackWsNoteReconnect(reason) {
  state.reconnects += 1;
  if (reason === "heartbeat_timeout") state.heartbeatTimeouts += 1;
  state.lastError = reason || null;
}

export function slackWsNoteHandleMessage(ms) {
  pushSample(state.handleMessageSamples, ms);
}

export function slackWsNoteError(msg) {
  state.lastError = String(msg || "error").slice(0, 200);
}

export function getSlackWsMetrics() {
  const idleMs =
    state.lastFrameAt != null ? Math.max(0, Date.now() - state.lastFrameAt) : null;
  const uptimeMs =
    state.connectedAt != null ? Math.max(0, Date.now() - state.connectedAt) : null;
  return {
    frames: state.frames,
    reconnects: state.reconnects,
    heartbeatTimeouts: state.heartbeatTimeouts,
    lastFrameAt: state.lastFrameAt,
    connectedAt: state.connectedAt,
    idleMs,
    uptimeMs,
    lastConnectLatencyMs: state.lastConnectLatencyMs,
    lastError: state.lastError,
    connectLatency: summarize(state.connectLatencySamples),
    interFrame: summarize(state.interFrameSamples),
    handleMessage: summarize(state.handleMessageSamples),
  };
}

/** Prometheus text lines for /metrics */
export function renderSlackWsPrometheus() {
  const m = getSlackWsMetrics();
  const lines = [];
  lines.push("# HELP xclaw_slack_ws_frames_total WebSocket frames received");
  lines.push("# TYPE xclaw_slack_ws_frames_total counter");
  lines.push(`xclaw_slack_ws_frames_total ${m.frames}`);
  lines.push("# HELP xclaw_slack_ws_reconnects_total Socket Mode reconnects");
  lines.push("# TYPE xclaw_slack_ws_reconnects_total counter");
  lines.push(`xclaw_slack_ws_reconnects_total ${m.reconnects}`);
  lines.push("# HELP xclaw_slack_ws_heartbeat_timeouts_total Heartbeat-forced reconnects");
  lines.push("# TYPE xclaw_slack_ws_heartbeat_timeouts_total counter");
  lines.push(`xclaw_slack_ws_heartbeat_timeouts_total ${m.heartbeatTimeouts}`);
  lines.push("# HELP xclaw_slack_ws_idle_ms Ms since last frame");
  lines.push("# TYPE xclaw_slack_ws_idle_ms gauge");
  lines.push(`xclaw_slack_ws_idle_ms ${m.idleMs ?? -1}`);
  lines.push("# HELP xclaw_slack_ws_connect_latency_ms Last connections.open→hello path latency");
  lines.push("# TYPE xclaw_slack_ws_connect_latency_ms gauge");
  lines.push(`xclaw_slack_ws_connect_latency_ms ${m.lastConnectLatencyMs ?? -1}`);
  if (m.interFrame.p50 != null) {
    lines.push("# HELP xclaw_slack_ws_inter_frame_ms Inter-frame gap percentiles");
    lines.push("# TYPE xclaw_slack_ws_inter_frame_ms gauge");
    lines.push(`xclaw_slack_ws_inter_frame_ms{quantile="0.5"} ${m.interFrame.p50}`);
    lines.push(`xclaw_slack_ws_inter_frame_ms{quantile="0.95"} ${m.interFrame.p95}`);
    lines.push(`xclaw_slack_ws_inter_frame_ms{quantile="0.99"} ${m.interFrame.p99}`);
  }
  if (m.handleMessage.p50 != null) {
    lines.push("# HELP xclaw_slack_ws_handle_message_ms Message handler duration");
    lines.push("# TYPE xclaw_slack_ws_handle_message_ms gauge");
    lines.push(`xclaw_slack_ws_handle_message_ms{quantile="0.5"} ${m.handleMessage.p50}`);
    lines.push(`xclaw_slack_ws_handle_message_ms{quantile="0.95"} ${m.handleMessage.p95}`);
  }
  if (m.connectLatency.avg != null) {
    lines.push("# HELP xclaw_slack_ws_connect_latency_avg_ms Average connect latency");
    lines.push("# TYPE xclaw_slack_ws_connect_latency_avg_ms gauge");
    lines.push(`xclaw_slack_ws_connect_latency_avg_ms ${m.connectLatency.avg}`);
  }
  return lines.join("\n");
}
