# WebSocket heartbeat

## Server (`ws-hub`)

| Option | Default | Meaning |
|--------|---------|---------|
| `heartbeatMs` | 25000 | Interval between app-level `ping` messages |
| `missThreshold` | 2 | Consecutive missed pongs before close |

Algorithm (each tick):

1. If client still `alive === false` from last tick → `misses++`
2. If `misses >= missThreshold` → close socket (`deadClosed++`)
3. Set `alive = false`, send `{ type: "ping", t, seq }`
4. Any inbound frame (text/ping/pong/close) sets `alive = true`, resets misses

Config:

```js
attachWebSocketHub(server, {
  path: "/ws/events",
  heartbeatMs: cfg.gateway?.wsHeartbeatMs || 25_000,
  missThreshold: cfg.gateway?.wsMissThreshold || 2,
});
```

`hub.heartbeatStats()` → `{ pingsSent, pongsRecv, deadClosed, connected, clients, seq }`

## Client

Reply to every `ping` with:

```json
{ "type": "pong", "t": 1730000000000, "seq": 12 }
```

Control UI does this automatically.

## Why

Detects half-open TCP / silent NAT drops that pure server→client traffic cannot.
