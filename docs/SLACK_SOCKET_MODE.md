# Slack Socket Mode

## Heartbeat monitoring

If **no WebSocket frame** arrives for `heartbeatMs` (default **90000**), XClaw:

1. Logs `heartbeat timeout`
2. Closes the socket
3. Reconnects via `apps.connections.open` with jittered backoff

Any message (including `hello`, events, envelope acks) resets the idle timer.

| Config | Env | Default |
|--------|-----|---------|
| `channels.slack.heartbeatMs` | `XCLAW_SLACK_HEARTBEAT_MS` | `90000` |
| `0` | — | disable heartbeat |

```json
"slack": {
  "enabled": true,
  "botToken": "xoxb-...",
  "appToken": "xapp-...",
  "socketMode": true,
  "heartbeatMs": 90000
}
```

## Modes

- **socket** — app token + WebSocket (preferred)
- **poll** — `conversations.history` on `channelIds`

## WebSocket latency metrics

Module: `src/channels/slack/ws-metrics.mjs`

| Metric | Meaning |
|--------|---------|
| `frames` | Total WS frames received |
| `lastConnectLatencyMs` | `connections.open` start → `hello` |
| `interFrame` | Gaps between frames (p50/p95/p99) |
| `handleMessage` | Agent handler duration |
| `reconnects` / `heartbeatTimeouts` | Reconnect counters |
| `idleMs` | Time since last frame |

**JSON:** `channelManager.status()` → slack entry `wsMetrics`  
**Prometheus:** `GET /metrics` → `xclaw_slack_ws_*`

## app_mention

Socket Mode handles both `message` and `app_mention` events. Bot `<@U…>` tokens are stripped from the prompt text.

Subscribe in the Slack app: **message.channels** (or groups) and **app_mention**.

## Alerts

See `deploy/grafana/xclaw-alerts.yaml` and `xclaw-alert-rules.json`.
